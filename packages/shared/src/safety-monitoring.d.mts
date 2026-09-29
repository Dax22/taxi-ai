export interface SafetyPosition { lat:number; lng:number; accuracy:number; capturedAt:number }
export interface SafetySignal { kind:'impact'|'distress'|'manual'; capturedAt:number; peakG?:number; speedBefore?:number; speedAfter?:number; windowMs?:number; levelDb?:number; durationMs?:number }
export interface MonitoringOptions { enabled?:boolean; crash:boolean; distress:boolean; contactIds:string[]; emergency:boolean; consent:boolean }
export interface AutoAlert { id:string; kind:SafetySignal['kind']; status:string; dueAt:number; createdAt:number; version:number; deliveries:{id:string;name:string;status:string;attempts:number}[] }
export interface MonitoringData { viewerId:string;rideId:string;serverNow:number;version:number;canMonitor:boolean;monitoring:boolean;preferences:MonitoringOptions;settings:{delivery:string;emergencyService:string|null;countdownSeconds:number;experimental:boolean;foregroundOnly:boolean};alerts:AutoAlert[];warnings:{id:string;label:string;lat:number;lng:number;radiusM:number;expiresAt:number}[];coverage:string }
export const SAFETY_COUNTDOWN_MS:number;
export const SAFETY_SIGNAL_LABELS:Readonly<Record<SafetySignal['kind'],string>>;
export function signalQualifies(s:unknown):boolean;
export function createSignalDetector(emit:(signal:SafetySignal)=>void):{speed(value:number|null,at:number):void;motion(g:number,at:number):void;audio(db:number,at:number):void};
export function finite(n:unknown,min:number,max:number):boolean;
