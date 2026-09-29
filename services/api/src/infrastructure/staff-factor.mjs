import { randomBytes, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto';
import { check } from '../shared/errors.mjs';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function encode(bytes) {
  let bits=0,value=0,text='';
  for (const byte of bytes) { value=(value<<8)|byte;bits+=8;while(bits>=5){text+=ALPHABET[(value>>>(bits-5))&31];bits-=5;} }
  if(bits>0)text+=ALPHABET[(value<<(5-bits))&31]; return text;
}
function decode(text) {
  check(typeof text==='string' && /^[A-Z2-7]{32}$/.test(text),'INVALID_MFA_SECRET','The authenticator configuration is invalid.');
  let bits=0,value=0;const bytes=[];
  for(const char of text){value=(value<<5)|ALPHABET.indexOf(char);bits+=5;if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8;}}
  return Buffer.from(bytes);
}
// RFC 6238 / RFC 4226, SHA-1, 30 second period. The persisted counter is
// consumed atomically by the service, preventing reuse on another session.
export function totpCode(secret, now, digits=6) {
  check(Number.isSafeInteger(now)&&now>=0&&[6,8].includes(digits),'INVALID_INPUT','Invalid authenticator time.');
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(now/30_000)));
  const digest=createHmac('sha1',decode(secret)).update(counter).digest(),offset=digest[19]&15;
  const truncated=digest.readUInt32BE(offset)&0x7fffffff;
  return String(truncated%(10**digits)).padStart(digits,'0');
}
export function createStaffFactor({ key = '', required = false } = {}) {
  check(typeof key==='string'&&(key===''||/^[a-fA-F0-9]{64}$/.test(key)),'INVALID_STAFF_MFA_KEY','TAXI_AI_STAFF_MFA_KEY must be 64 hexadecimal characters.');
  check(!required||key.length===64,'INVALID_STAFF_MFA_KEY','A persistent TAXI_AI_STAFF_MFA_KEY is required when TAXI_AI_STAFF_MFA_REQUIRED is enabled.');
  const encryptionKey=key?Buffer.from(key,'hex'):null;
  function ready(){check(encryptionKey,'MFA_UNAVAILABLE','Authenticator setup requires server configuration.');}
  function encrypt(userId,secret){
    ready();const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey,iv);
    cipher.setAAD(Buffer.from(`taxi-ai:staff-mfa:v1:${userId}`));
    const ciphertext=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
    return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),ciphertext.toString('base64url')].join('.');
  }
  function decrypt(userId,sealed){
    ready();try{
      const parts=sealed.split('.');if(parts.length!==4||parts[0]!=='v1')throw new Error('Invalid sealed factor');
      const iv=Buffer.from(parts[1],'base64url'),tag=Buffer.from(parts[2],'base64url');if(iv.length!==12||tag.length!==16)throw new Error('Invalid sealed factor');
      const decipher=createDecipheriv('aes-256-gcm',encryptionKey,iv);decipher.setAAD(Buffer.from(`taxi-ai:staff-mfa:v1:${userId}`));decipher.setAuthTag(tag);
      const secret=Buffer.concat([decipher.update(Buffer.from(parts[3],'base64url')),decipher.final()]).toString('utf8');decode(secret);return secret;
    }catch{check(false,'MFA_UNAVAILABLE','The authenticator configuration cannot be opened. Contact your server operator.');}
  }
  return Object.freeze({
    available:Boolean(encryptionKey),required:Boolean(required),
    create(userId,email){ready();const secret=encode(randomBytes(20));return {secret,secretEncrypted:encrypt(userId,secret),
      uri:`otpauth://totp/${encodeURIComponent(`Taxi AI Staff:${email}`)}?secret=${secret}&issuer=Taxi%20AI%20Staff&algorithm=SHA1&digits=6&period=30`};},
    verify(userId,secretEncrypted,code,now,lastCounter=-1){
      ready();check(typeof code==='string'&&/^\d{6}$/.test(code),'INVALID_MFA_CODE','Enter a current authenticator code.');
      const secret=decrypt(userId,secretEncrypted),current=Math.floor(now/30_000);let matched=null;
      // A one-step clock tolerance; accepted steps remain single-use globally.
      for(const counter of [current,current-1,current+1]){
        if(counter<0)continue;
        const candidate=totpCode(secret,counter*30_000);
        if(timingSafeEqual(Buffer.from(candidate),Buffer.from(code))&&counter>lastCounter)matched=counter;
      }
      return matched;
    },
  });
}
