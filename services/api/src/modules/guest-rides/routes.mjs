export function guestRideRoutes(guestRides) {
  return [
    { method: 'GET', path: /^\/api\/guest-rides\/([a-f0-9-]{36})$/, access: 'read',
      handle: async ({ user, match }) => ({ body: (await guestRides.get(user.id, match[1])) }) },
    { method: 'POST', path: /^\/api\/guest-rides\/([a-f0-9-]{36})\/(link|revoke)$/, access: 'write',
      handle: async ({ user, token, match, data, key }) => ({ body: (await guestRides.command({ userId: user.id, sessionToken: token, rideId: match[1], action: match[2], data, key })) }) },
    { method: 'POST', path: /^\/api\/guest-trip\/view$/, access: 'capability',
      handle: async ({ data }) => ({ body: (await guestRides.sharedTrip(data)) }) },
  ];
}
