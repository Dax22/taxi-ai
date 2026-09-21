export const VEHICLE_PHOTO_CONSENT: 'vehicle-photo-v1';
export const PHOTO_CHECK_NOTICE: string;
export type CheckOutcome = 'possible_match'|'possible_mismatch'|'inconclusive'|'pending'|'unavailable'|'trip_ended';
export type CheckField = 'plate'|'make'|'model'|'body'|'colour';
export const CHECK_LABELS: Readonly<Record<CheckOutcome,string>>;
export const CHECK_GUIDANCE: Readonly<Record<CheckOutcome,string>>;
export const CHECK_FIELDS: Readonly<Record<CheckField,string>>;
export interface VehiclePhoto { mimeType:'image/jpeg'|'image/png'; base64:string }
export interface VehicleCheck { id:string; rideId:string; createdAt:number; expiresAt:number; current:boolean; outcome:CheckOutcome;
  fields:Array<{key:CheckField;expected:string;observed:string;status:'match'|'different'|'unclear'}>; reasons:string[] }
export interface VehicleChecks { rideId:string;enabled:boolean;provider:'OpenAI'|null;canCheck:boolean;consentVersion:typeof VEHICLE_PHOTO_CONSENT;checks:VehicleCheck[] }
export function readVehicleCheck(v:unknown,rideId:string):VehicleCheck;
export function readVehicleChecks(v:unknown,rideId:string):VehicleChecks;
