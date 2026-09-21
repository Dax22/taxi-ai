import type { VehicleChecks,VehicleCheck,VehiclePhoto } from './vehicle-checks.mjs';
export interface CheckState {value:VehicleChecks|null;loading:boolean;pending:boolean;error:string}
export interface CheckController {snapshot():CheckState;subscribe(listener:()=>void):()=>void;load(keepError?:boolean):Promise<void>;
  analyse(photo:VehiclePhoto):Promise<boolean>;activate():Promise<void>;pause():void}
export function createVehicleCheckController(options:{rideId:string;api:{load(id:string):Promise<VehicleChecks>;
  submit(id:string,data:{image:VehiclePhoto;consentVersion:string},key:string):Promise<{check:VehicleCheck}>};makeKey:()=>string}):CheckController;
