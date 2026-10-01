export function checkoutPaymentRoutes(payments) {
  const path = '^/api/checkout-payments/(ride|food)/([a-f0-9-]{36})';
  return [
    {method:'GET',path:new RegExp(path+'$'),access:'read',
      handle:async ({user,match}) => ({body:await payments.get(user.id,match[1],match[2])})},
    {method:'POST',path:new RegExp(path+'/(start|refresh)$'),access:'write',
      handle:async ({user,match,key,data,reauthenticate}) => ({body:await payments.command({userId:user.id,kind:match[1],targetId:match[2],action:match[3],key,data,reauthenticate})})},
  ];
}
