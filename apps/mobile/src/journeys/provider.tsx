import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PropsWithChildren } from 'react';
import { Alert, AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import { useSession } from '../session/provider';
import { JourneyController } from './controller';
import { WorkController } from '../work/controller';
import { currentPosition } from '../work/location';
import type { Notifications } from '../../../../packages/shared/src/mobile-journeys.mjs';
import { listenForPush } from '../notifications/push';
interface Operations { work:WorkController; journey(id:string):JourneyController; updates:Notifications|null; refreshUpdates():Promise<void>; pushId:number|null; dismissPush():void }
const Context=createContext<Operations|null>(null);
export function OperationsProvider({children}:PropsWithChildren){
  const {client,user,blocked,registerModeGuard}=useSession();
  const work=useMemo(()=>new WorkController(client,randomUUID,currentPosition),[client]);
  const controllers=useRef(new Map<string,JourneyController>()),[updates,setUpdates]=useState<Notifications|null>(null),[pushId,setPushId]=useState<number|null>(null);
  const updateGeneration=useRef(0),updatesBusy=useRef(false);
  const refreshUpdates=useCallback(async()=>{
    if(!client.account()||AppState.currentState!=='active'||blocked||updatesBusy.current)return;
    const generation=updateGeneration.current;updatesBusy.current=true;
    try{const result=await client.notifications();if(generation===updateGeneration.current)setUpdates(result);}catch{}finally{updatesBusy.current=false;}
  },[client,blocked]);
  useEffect(()=>{
    if(blocked||!user)return;
    if(user.driver&&AppState.currentState==='active')work.activate();
    void refreshUpdates();
    const poll=setInterval(()=>{if(user.driver){void work.heartbeat().then(()=>work.refresh());}void refreshUpdates();},10_000);
    const tick=setInterval(()=>work.tick(),1000);
    const state=AppState.addEventListener('change',(next)=>{if(next!=='active'){work.pause();updateGeneration.current++;}else{if(user.driver)work.activate();void refreshUpdates();}});
    return()=>{work.pause();updateGeneration.current++;clearInterval(poll);clearInterval(tick);state.remove();};
  },[user?.id,Boolean(user?.driver),blocked,work,refreshUpdates]);
  useEffect(()=>registerModeGuard(async(next)=>{
    if(next!=='customer'||!client.account()?.driver)return true;
    if(work.snapshot().busy||work.snapshot().uncertain){Alert.alert('Check your work status','Finish or retry the pending work action before switching to Customer.');return false;}
    await work.refresh();const state=work.snapshot();
    if(state.stale){Alert.alert('Reconnect before switching','Refresh Work to check your availability.');return false;}
    if(!state.availability?.online)return true;
    const agreed=await new Promise<boolean>((resolve)=>Alert.alert('Go offline?','Switching to Customer stops new work requests for your account.',[
      {text:'Stay in Work',style:'cancel',onPress:()=>resolve(false)},{text:'Go offline',onPress:()=>resolve(true)}],{cancelable:false}));
    if(!agreed)return false;
    const offline=await work.offline();if(!offline)Alert.alert('Offline status unconfirmed','Return to Work and retry the pending action.');return offline;
  }),[client,work,registerModeGuard]);
  useEffect(()=>{if(user)return listenForPush(setPushId);},[user?.id]);
  // Disposal is deferred across Strict Mode's effect replay; account-key changes destroy private controllers.
  const alive=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;queueMicrotask(()=>{if(!alive.current){work.dispose();for(const c of controllers.current.values())c.dispose();controllers.current.clear();}});};},[work]);
  const value:Operations={work,updates,refreshUpdates,pushId,dismissPush:()=>setPushId(null),journey:(id)=>{
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
