import { lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

/** Optional peer-authenticated test socket; never accepts a production URL or a shared directory. */
export function validatePrivatePostgresTestUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'postgresql:' || url.hostname !== 'localhost' || url.password
    || !/^\/taxi_ai_test[a-z0-9_]*$/.test(url.pathname) || url.hash
    || !/^\d+$/.test(url.port) || Number(url.port) < 1024
    || [...url.searchParams.keys()].join(',') !== 'host') throw new Error('Use a private PostgreSQL test socket URL.');
  const socket = url.searchParams.get('host'), home = realpathSync(homedir());
  if (!socket || !socket.startsWith(home + sep) || realpathSync(socket) !== socket)
    throw new Error('Test socket must be a real directory within the current home.');
  const parts = relative(home, socket).split(sep);
  if (parts.length !== 2 || !/^taxi-ai-pg-acceptance-[a-z0-9-]+$/.test(parts[0]) || parts[1] !== 'socket')
    throw new Error('Test socket must belong to a dedicated acceptance cluster.');
  for (const path of [dirname(socket), socket]) {
    const info = lstatSync(path);
    if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077))
      throw new Error('Acceptance directories must be owned by the current user with mode 0700.');
  }
  const info = lstatSync(join(socket, `.s.PGSQL.${url.port}`));
  if (!info.isSocket() || info.uid !== process.getuid()) throw new Error('Acceptance socket is not owned by this user.');
  return value;
}
