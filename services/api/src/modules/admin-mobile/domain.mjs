import { check } from '../../shared/errors.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function mobileFilters(query={}){
 const keys=Object.keys(query);check(keys.every(key=>['window','platform'].includes(key)),'INVALID_INPUT','Choose supported Mobile Operations filters.');
 const window=query.window??'24h',platform=query.platform??'all';check(['24h','7d'].includes(window),'INVALID_INPUT','Choose a valid reporting window.');
 check(['all','ios','android'].includes(platform),'INVALID_INPUT','Choose iOS, Android or all devices.');
 return{window,platform};
}
export function mobileSessionId(value){check(typeof value==='string'&&UUID.test(value),'INVALID_INPUT','Choose a valid native device session.');return value;}
export function mobileCommandKey(value){check(typeof value==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(value),'INVALID_IDEMPOTENCY_KEY','A unique request key is required.');return value;}
