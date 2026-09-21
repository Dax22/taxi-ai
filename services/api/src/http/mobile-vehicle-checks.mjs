import { check } from '../shared/errors.mjs';
export async function mobileVehicleChecks({ vehicleChecks,session,path,write,data,key }) {
  const match = path.match(/^\/vehicle-checks\/rides\/([a-f0-9-]{36})$/);
  check(match,'NOT_FOUND','Vehicle check endpoint not found.');
  const input = { userId:session.user.id,nativeSessionId:session.id };
  return write ? vehicleChecks.analyse(input,match[1],data,key) : vehicleChecks.list(input,match[1]);
}
