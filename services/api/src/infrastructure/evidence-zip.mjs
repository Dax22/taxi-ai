import { createHash } from 'node:crypto';

// Small, deterministic ZIP (stored entries) avoids remote archiving services and a new dependency.
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xEDB88320 : 0);
  return value >>> 0;
});
function crc32(data) {
  let value = 0xFFFFFFFF;
  for (const byte of data) value = crcTable[(value ^ byte) & 0xFF] ^ (value >>> 8);
  return (value ^ 0xFFFFFFFF) >>> 0;
}
export const sha256 = data => createHash('sha256').update(data).digest('hex');
export function evidenceZip(entries) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 32) throw new Error('Invalid evidence archive entries.');
  const names = new Set(), local = [], central = []; let offset = 0, total = 0;
  for (const entry of entries) {
    if (typeof entry.name !== 'string' || !/^[a-zA-Z0-9_./-]{1,160}$/.test(entry.name) || entry.name.startsWith('/') || entry.name.includes('..') || names.has(entry.name)) throw new Error('Invalid evidence archive filename.');
    names.add(entry.name);
    const filename = Buffer.from(entry.name, 'utf8'), body = Buffer.isBuffer(entry.body) ? entry.body : Buffer.from(entry.body);
    total += body.length;
    if (total > 14 * 1024 * 1024) throw new Error('Evidence archive exceeds its size limit.');
    const checksum = crc32(body);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034B50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0, 8); header.writeUInt32LE(checksum, 14); header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(body.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, body);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014B50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8); directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(body.length, 20); directory.writeUInt32LE(body.length, 24);
    directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, filename);
    offset += header.length + filename.length + body.length;
  }
  const dirSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0); end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(dirSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end], offset + dirSize + end.length);
}
