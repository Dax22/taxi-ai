export type KemmyStep = 'welcome'|'email'|'experience'|'notifications'|'safety'|'finish'|'complete';
export interface KemmySetup {
  version: 1; assistant: 'Kemmy'; deterministic: true; nextStep: KemmyStep; autoOpen: boolean;
  startedAt: number|null; emailDeferredAt: number|null; experience: 'customer'|'driver'|'eats_seller'|null;
  notificationsChoice: 'enabled'|'in_app'|'later'|null; safetyChoice: 'review'|'later'|null;
  dismissedAt: number|null; completedAt: number|null; emailVerified: boolean;
}
const time=(v:unknown)=>v===null||(Number.isSafeInteger(v)&&Number(v)>=0);
export function readKemmySetup(value: unknown): KemmySetup {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Taxi Ai returned an invalid Kemmy setup response.');
  const v=value as Record<string,unknown>;
  if(v.version!==1||v.assistant!=='Kemmy'||v.deterministic!==true||typeof v.autoOpen!=='boolean'||typeof v.emailVerified!=='boolean'
    ||!['welcome','email','experience','notifications','safety','finish','complete'].includes(String(v.nextStep))
    ||!time(v.startedAt)||!time(v.emailDeferredAt)||!time(v.dismissedAt)||!time(v.completedAt)
    ||!(v.experience===null||['customer','driver','eats_seller'].includes(String(v.experience)))
    ||!(v.notificationsChoice===null||['enabled','in_app','later'].includes(String(v.notificationsChoice)))
    ||!(v.safetyChoice===null||['review','later'].includes(String(v.safetyChoice)))) {
    throw new Error('Taxi Ai returned an invalid Kemmy setup response.');
  }
  return v as unknown as KemmySetup;
}
