import { check } from '../../shared/errors.mjs';
export function adminInvestigationRoutes(service){
 const prefix='/api/admin/console/investigations';
 return [
  {method:'GET',path:/^\/api\/admin\/console\/investigations$/,access:'read',handle:async({user,query})=>{
    const params=[...query.entries()];check(params.length<=2&&new Set(params.map(([key])=>key)).size===params.length
      && params.every(([key])=>['service','transactionId'].includes(key)),'INVALID_INPUT','Use only a transaction service and reference.');
    const kind=query.get('service'),id=query.get('transactionId');
    if(!kind&&!id)return {body:{viewerId:user.id,record:null,history:[],notice:'Enter a case reference and verify legal authority before exporting evidence.'}};
    check(kind&&id,'INVALID_INPUT','Choose both the service and transaction reference.');
    return {body:await service.preview(user.id,kind,id)};
  }},
  {method:'POST',path:/^\/api\/admin\/console\/investigations\/export$/,access:'write',maxBodyBytes:4096,
    handle:async({user,data})=>({archive:await service.create(user.id,data)})},
 ];
}
