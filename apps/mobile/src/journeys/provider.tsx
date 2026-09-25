import { SafetyController } from '../safety/controller';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import { useSession } from '../session/provider';
import { JourneyController } from './controller';
import { WorkController } from '../work/controller';
import { currentPosition } from '../work/location';
import type { Notifications } from '../../../../packages/shared/src/mobile-journeys.mjs';
import { listenForPush } from '../notifications/push';
interface Operations { safety(id:string):SafetyController; work:WorkController; journey(id:string):JourneyController; updates:Notifications|null; refreshUpdates():Promise<void>; pushId:number|null; dismissPush():void }
const Context=createContext<Operations|null>(null);
export function OperationsProvider({children}:PropsWithChildren){
  const {client,user,role,blocked}=useSession();
  const work=useMemo(()=>new WorkController(client,randomUUID,currentPosition),[client]);
  const safetyControllers=useRef(new Map<string,SafetyController>());
  const controllers=useRef(new Map<string,JourneyController>()),[updates,setUpdates]=useState<Notifications|null>(null),[pushId,setPushId]=useState<number|null>(null);
  const updateGeneration=useRef(0),updatesBusy=useRef(false);
  const refreshUpdates=useCallback(async()=>{
    if(!client.account()||AppState.currentState!=='active'||blocked||updatesBusy.current)return;
    const generation=updateGeneration.current;updatesBusy.current=true;
    try{const result=await client.notifications();if(generation===updateGeneration.current)setUpdates(result);}catch{if(generation===updateGeneration.current)setUpdates(null);}finally{updatesBusy.current=false;}
  },[client,blocked]);
  useEffect(()=>{
    if(blocked||!user||!role)return;
    if(role==='driver'&&user.driver&&AppState.currentState==='active')work.activate();
    void refreshUpdates();
    const poll=setInterval(()=>{if(role==='driver'&&user.driver){void work.heartbeat().then(()=>work.refresh());}void refreshUpdates();},10_000);
    const workPoll=setInterval(()=>{if(role==='driver'&&user.driver)void work.refresh();},3000);
    const tick=setInterval(()=>work.tick(),1000);
    const state=AppState.addEventListener('change',(next)=>{if(next!=='active'){work.pause();updateGeneration.current++;}else{if(role==='driver'&&user.driver)work.activate();void refreshUpdates();}});
    return()=>{work.pause();updateGeneration.current++;clearInterval(poll);clearInterval(workPoll);clearInterval(tick);state.remove();};
  },[user?.id,Boolean(user?.driver),role,blocked,work,refreshUpdates]);
  useEffect(()=>{if(user)return listenForPush(setPushId,()=>void refreshUpdates());},[user?.id,refreshUpdates]);
  // Disposal is deferred across Strict Mode's effect replay; account-key changes destroy private controllers.
  const alive=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;queueMicrotask(()=>{if(!alive.current){work.dispose();for(const c of controllers.current.values())c.dispose();controllers.current.clear();for(const c of safetyControllers.current.values())c.dispose();safetyControllers.current.clear();}});};},[work]);
  const value:Operations={safety:(id)=>{let c=safetyControllers.current.get(id);if(!c){c=new SafetyController(client,id,randomUUID);safetyControllers.current.set(id,c);}return c;},work,updates,refreshUpdates,pushId,dismissPush:()=>setPushId(null),journey:(id)=>{
    let controller=controllers.current.get(id);if(!controller){controller=new JourneyController(client,id,randomUUID);controllers.current.set(id,controller);}return controller;
  }};
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useOperations(){const value=useContext(Context);if(!value)throw new Error('Journey controls are unavailable.');return value;}
export function useWork(){const {work}=useOperations();return{controller:work,state:useSyncExternalStore(work.subscribe,work.snapshot)};}
export function useJourney(id:string){
  const operations=useOperations(),controller=operations.journey(id),{blocked}=useSession();
  const state=useSyncExternalStore(controller.subscribe,controller.snapshot);
  useFocusEffect(useCallback(()=>{
    if(blocked)return;
    if(AppState.currentState==='active')controller.activate();
    const listener=AppState.addEventListener('change',(next)=>next==='active'?controller.activate():controller.pause());
    const poll=setInterval(()=>void controller.refresh(),5000),tick=setInterval(()=>controller.tick(),1000);
    return()=>{listener.remove();clearInterval(poll);clearInterval(tick);controller.pause();};
  },[controller,blocked]));
  return{controller,state};
}

export function useSafety(id:string){
 const c=useOperations().safety(id),{blocked}=useSession();
 const state=useSyncExternalStore(c.subscribe,c.snapshot);
 useFocusEffect(useCallback(()=>{if(blocked)return;if(AppState.currentState==='active')c.activate();
 const listener=AppState.addEventListener('change',next=>next==='active'?c.activate():c.pause());
 const poll=setInterval(()=>void c.refresh(),10000);
 return()=>{listener.remove();clearInterval(poll);c.pause();};},[c,blocked]));
 return {controller:c,state};
}
