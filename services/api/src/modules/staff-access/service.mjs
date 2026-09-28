import { check } from '../../shared/errors.mjs';
import { fields, passwordInput } from '../../shared/validation.mjs';
import { ROLES, PERMISSIONS, permissions, commandInput, codeInput, auditFilters, MFA_SETUP_MS, MFA_STEPUP_MS } from './domain.mjs';

/** Staff authority is refreshed independently of ordinary account capabilities.
 * All commands are atomic; password hashing is outside the short transaction.
 * HTTP must bind authorize() to the authenticated session before invoking other
 * workspaces. Their services use requirePermission() again inside their UOW.
 */
export function createStaffAccessService({ repository, getAccount, getAccountByEmail, verifyPassword,
  sessionOwner, revokeSessions, tokens, unitOfWork, audit, clock, factor = { available:false,required:false }, mfaRequired = false }) {
  const required=Boolean(mfaRequired||factor.required);
  check(!required||factor.available,'INVALID_STAFF_MFA_KEY','Configure the staff authenticator encryption key before requiring MFA.');
  async function membership(userId) {
    const account=await getAccount(userId);check(account,'FORBIDDEN','Staff access is required.');
    const stored=await repository.membership(userId);
    const member=stored??(account.role==='admin'?{userId,role:'owner',status:'active',version:1}:null);
    check(member?.status==='active','FORBIDDEN','Your account does not have active staff access.');
    return {...member,account};
  }
  async function requirePermission(userId,permission) {
    check(PERMISSIONS.includes(permission),'FORBIDDEN','This staff permission is not available.');
    const member=await membership(userId);
    check(permissions(member.role).includes(permission),'FORBIDDEN','Your staff role does not allow this action.');
    return {userId,role:member.role,version:member.version,permissions:permissions(member.role)};
  }
  async function mfaState(member,sessionToken) {
    const enrolled=await repository.factor(member.userId),needs=required||Boolean(enrolled);
    let verifiedUntil=null;
    if(enrolled&&factor.available&&sessionToken&&await sessionOwner(sessionToken)===member.userId){
      const proof=await repository.stepup(tokens.digest(sessionToken),member.userId,clock());
      if(proof?.factorVersion===enrolled.version&&proof.membershipVersion===member.version)verifiedUntil=proof.verifiedUntil;
    }
    return {available:Boolean(factor.available),enrolled:Boolean(enrolled),required:needs,
      verifiedUntil,needsVerification:needs&&!verifiedUntil,stepupMinutes:MFA_STEPUP_MS/60_000};
  }
  async function describe(userId,{sessionToken}={}) {
    return await unitOfWork(async()=>{const member=await membership(userId);return {
      userId,role:member.role,permissions:permissions(member.role),version:member.version,mfa:await mfaState(member,sessionToken)};});
  }
  async function authorize(userId,permission,{sessionToken}={}) {
    return await unitOfWork(async()=>{
      await requirePermission(userId,permission);const member=await membership(userId),state=await mfaState(member,sessionToken);
      if(state.needsVerification){check(state.available,'MFA_UNAVAILABLE','The staff authenticator configuration is unavailable.');
        check(state.enrolled,'MFA_SETUP_REQUIRED','Set up an authenticator before opening staff workspaces.');
        check(false,'MFA_REQUIRED','Confirm your authenticator code to continue.');}
      return {userId,role:member.role,permissions:permissions(member.role),version:member.version,mfa:state};
    });
  }
  const stamp=(userId)=>({viewerId:userId,serverNow:clock()});
  async function list(userId) {
    return await unitOfWork(async()=>{await requirePermission(userId,'staff.manage');return {
      items:(await repository.staff()).map(({accountRole,...row})=>({...row,mfaEnrolled:Boolean(row.mfaEnrolled),ownerEligible:accountRole==='admin'})),
      roles:ROLES.map((role)=>({...role,assignable:role.id!=='owner'})),...stamp(userId)};});
  }
  async function auditLog(userId,query) {
    const filter=auditFilters(query);return await unitOfWork(async()=>{await requirePermission(userId,'audit.read');
      const rows=await repository.audit(filter),items=rows.slice(0,filter.limit).map((row)=>({...row,detail:JSON.parse(row.detail)}));
      return {items,nextBefore:rows.length>filter.limit?items.at(-1).id:null,...stamp(userId)};});
  }
  async function record(userId,action,subjectId,detail,now) {
    await repository.record(userId,action,subjectId,detail,now);await audit.record(userId,action,subjectId,now);
  }
  async function command({userId,action,data,key}) {
    const input=commandInput(action,data,key),fingerprint=tokens.digest(JSON.stringify([action,input]));
    return await unitOfWork(async()=>{
      await requirePermission(userId,'staff.manage');const previous=await repository.findCommand(userId,key);
      if(previous){check(previous.fingerprint===fingerprint,'KEY_REUSED','This request key belongs to another staff action.');return {...await list(userId),replayed:true};}
      const now=clock(),account=action==='assign'?await getAccountByEmail(input.email):await getAccount(input.userId);
      check(account,'NOT_FOUND','Register this account before assigning staff access.');
      await repository.ensureLegacyOwner(account.id,now);
      const existing=await repository.membership(account.id),version=existing?.version??0;
      check(version===input.expectedVersion,'STALE_VERSION','Staff access changed. Refresh the list before trying again.');
      if(action==='assign'){
        check(input.role!=='owner'||account.role==='admin','OWNER_BOOTSTRAP_REQUIRED','Owner access is reserved for an operator-bootstrapped administrator.');
      }else check(existing,'NOT_FOUND','This account does not have a staff membership.');
      if(action==='revoke-sessions')check(account.id!==userId,'FORBIDDEN','Use Sign out for your own session, or ask another owner to revoke all of your sessions.');
      if(action!=='revoke-sessions'){
        const removesOwner=existing?.status==='active'&&existing.role==='owner'&&(action==='revoke'||input.role!=='owner');
        check(!removesOwner||await repository.ownerCount()>1,'LAST_OWNER','The last active owner cannot be removed or demoted.');
        check(account.id!==userId,'FORBIDDEN','Ask another owner to change your staff role.');
        const nextRole=action==='assign'?input.role:existing.role,nextStatus=action==='assign'?'active':'revoked';
        check(await repository.saveMembership(account.id,nextRole,nextStatus,version,now),'STALE_VERSION','Staff access changed. Refresh the list.');
      }
      // A stale browser/device session must not regain access after a regrant.
      await repository.clearStepups(account.id);await repository.removePending(account.id);await revokeSessions(account.id);
      await record(userId,`staff.${action}`,account.id,{reason:input.reason,previousRole:existing?.role??null,
        role:action==='assign'?input.role:existing.role,previousVersion:version},now);
      await repository.saveCommand(userId,key,fingerprint);
      return {...await list(userId),replayed:false};
    });
  }
  async function currentSession(userId,sessionToken) {
    check(typeof sessionToken==='string'&&await sessionOwner(sessionToken)===userId,'UNAUTHENTICATED','Sign in to configure your authenticator.');
    return tokens.digest(sessionToken);
  }
  async function withSession(userId,sessionToken,run) {
    return await unitOfWork(async()=>{
      await currentSession(userId,sessionToken);await membership(userId);
      return await run();
    });
  }
  async function enroll({userId,sessionToken,data}) {
    fields(data,['password']);const password=passwordInput(data.password);
    await membership(userId);await currentSession(userId,sessionToken);check(factor.available,'MFA_UNAVAILABLE','Authenticator setup requires server configuration.');
    check(await verifyPassword(userId,password),'INVALID_CREDENTIALS','The password is incorrect.');
    return await unitOfWork(async()=>{
      const member=await membership(userId),hash=await currentSession(userId,sessionToken);
      check(!(await repository.factor(userId)),'MFA_ALREADY_ENROLLED','An authenticator is already configured for your account.');
      const setup=factor.create(userId,member.account.email),expiresAt=clock()+MFA_SETUP_MS;
      await repository.savePending(userId,hash,setup.secretEncrypted,expiresAt);
      await record(userId,'staff.mfa_setup_started',userId,{},clock());
      return {setup:{secret:setup.secret,uri:setup.uri,expiresAt},...stamp(userId)};
    });
  }
  async function confirm({userId,sessionToken,data}) {
    const code=codeInput(data);return await unitOfWork(async()=>{
      const member=await membership(userId),hash=await currentSession(userId,sessionToken),now=clock();
      check(factor.available,'MFA_UNAVAILABLE','Authenticator setup requires server configuration.');
      check(!(await repository.factor(userId)),'MFA_ALREADY_ENROLLED','An authenticator is already configured.');
      const pending=await repository.pending(userId);
      check(pending&&pending.sessionHash===hash&&pending.expiresAt>now,'MFA_SETUP_EXPIRED','Start authenticator setup again in this browser session.');
      const counter=factor.verify(userId,pending.secretEncrypted,code,now);
      check(counter!==null,'INVALID_MFA_CODE','Enter a current authenticator code.');
      check(await repository.enableFactor(userId,pending.secretEncrypted,now,counter),'MFA_ALREADY_ENROLLED','An authenticator was already configured.');
      await repository.removePending(userId);await repository.clearStepups(userId);
      await repository.saveStepup(hash,userId,now+MFA_STEPUP_MS,1,member.version);
      await record(userId,'staff.mfa_enabled',userId,{},now);
      return {staff:await describe(userId,{sessionToken}),...stamp(userId)};
    });
  }
  async function verify({userId,sessionToken,data}) {
    const code=codeInput(data);return await unitOfWork(async()=>{
      const member=await membership(userId),hash=await currentSession(userId,sessionToken),now=clock();
      check(factor.available,'MFA_UNAVAILABLE','The authenticator configuration is unavailable.');
      const stored=await repository.factor(userId);check(stored,'MFA_SETUP_REQUIRED','Set up your authenticator first.');
      const counter=factor.verify(userId,stored.secretEncrypted,code,now,stored.lastCounter);
      check(counter!==null&&await repository.useCounter(userId,counter,stored.version),'INVALID_MFA_CODE','Enter a new authenticator code. Each code can be used once.');
      await repository.saveStepup(hash,userId,now+MFA_STEPUP_MS,stored.version,member.version);
      await record(userId,'staff.mfa_verified',userId,{},now);
      return {staff:await describe(userId,{sessionToken}),...stamp(userId)};
    });
  }
  async function listEligible(permission) {
    check(PERMISSIONS.includes(permission),'FORBIDDEN','Unknown staff permission.');
    return (await repository.eligible()).filter((member)=>permissions(member.role).includes(permission)).slice(0,200).map(({id,name})=>({id,name}));
  }
  return Object.freeze({describe,requirePermission,authorize,withSession,listEligible,list,auditLog,command,enroll,confirm,verify});
}
