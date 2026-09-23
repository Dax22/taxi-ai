const metadata = {
  overview: ['Overview', 'Nigeria operations, at a glance.'], accounts: ['Accounts', 'Know the people behind every journey.'],
  account: ['Account details', 'One profile. A complete view of their Taxi Ai activity.'], trips: ['Trips', 'Follow each request from its first offer to its final status.'],
  trip: ['Trip details', 'The people, vehicle and fare behind this journey.'], analytics: ['Analytics', 'Understand demand, journey outcomes and completed fares.'],
};
export function routeFor(location) {
  const path = location.pathname.replace(/\/$/, ''), match = path.match(/^\/admin(?:\/(accounts|trips|analytics)(?:\/([a-f0-9-]{36}))?)?$/);
  if (!match || (match[2] && match[1] === 'analytics')) throw new Error('This dashboard page does not exist.');
  const section = match[1] ?? 'overview', name = match[2] ? section === 'accounts' ? 'account' : 'trip' : section;
  const query = new URLSearchParams(location.search), endpoint = section === 'overview' ? 'analytics' : section;
  return { path, query, section, name, title: metadata[name][0], description: metadata[name][1],
    apiPath: '/api/admin/console/' + endpoint + (match[2] ? '/' + match[2] : '') + (query.size ? '?' + query : '') };
}
