import { fields } from '../../shared/validation.mjs';

export function announcementRoutes(announcements) {
  return [
    {method:'GET',path:/^\/api\/announcements$/,role:'customer',
      handle:async({user})=>({body:await announcements.forUser(user.id)})},
    {method:'POST',path:/^\/api\/announcements\/([a-f0-9-]{36})\/read$/,role:'customer',
      handle:async({user,match,data})=>{fields(data,[]);return {body:await announcements.read(user.id,match[1])};}},
    {method:'GET',path:/^\/api\/admin\/console\/announcements$/,access:'read',
      handle:async({user})=>({body:await announcements.admin(user)})},
    {method:'POST',path:/^\/api\/admin\/console\/announcements$/,access:'read',
      handle:async({user,data,key})=>({body:await announcements.create(user,data,key)})},
    {method:'POST',path:/^\/api\/admin\/console\/announcements\/([a-f0-9-]{36})\/(publish|cancel)$/,access:'read',
      handle:async({user,match,data,key})=>({body:await announcements.command(user,match[1],match[2],data,key)})},
  ];
}
