import type { MonitoringOptions,MonitoringData,SafetySignal,SafetyPosition,AutoAlert } from './safety-monitoring.mjs';
export interface MonitoringSensors {start(options:MonitoringOptions,emit:(signal:SafetySignal,position?:SafetyPosition|null)=>void,onStop:(note:string)=>void):Promise<()=>void>;position?():SafetyPosition|null}
export interface MonitoringState {data:MonitoringData|null;busy:boolean;active:boolean;error:string;uncertain:boolean;sensorNote:string;receivedAt:number}
export function createMonitoringController(ports:{viewerId?:string;rideId?:string;read:()=>Promise<unknown>;write:(action:string,data:unknown,key:string)=>Promise<unknown>;sensors:MonitoringSensors;makeKey:()=>string;onChange:(state:MonitoringState)=>void;clock?:()=>number}):{
 snapshot():MonitoringState;refresh():Promise<void>;start(options:MonitoringOptions):Promise<void>;retry():Promise<boolean>;pause(note?:string):void;stop():Promise<void>;panic():Promise<void>;cancel(a:AutoAlert):Promise<boolean>;reportZone(d:{label:string;lat:number;lng:number;radiusM:number;note:string}):Promise<boolean>;close():void;
};
