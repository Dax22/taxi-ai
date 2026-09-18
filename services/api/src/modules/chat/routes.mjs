import { check } from '../../shared/errors.mjs';

export function chatRoutes(chat) {
  return [
    { method: 'GET', path: /^\/api\/chat$/, access: 'read',
      handle: ({ user }) => ({ body: { conversations: chat.summaries(user.id) } }) },
    { method: 'GET', path: /^\/api\/rides\/([a-f0-9-]{36})\/chat$/, access: 'read',
      handle: ({ user, match, query }) => {
        const raw = query.get('after') ?? '0';
        check(query.getAll('after').length <= 1 && /^(0|[1-9]\d*)$/.test(raw), 'INVALID_CURSOR', 'Use a valid message sequence.');
        return { body: chat.thread(user.id, match[1], Number(raw)) };
      } },
    { method: 'POST', path: /^\/api\/rides\/([a-f0-9-]{36})\/chat\/messages$/, access: 'write',
      handle: ({ user, match, data, key }) => {
        const result = chat.send({ userId: user.id, rideId: match[1], data, key });
        return { status: result.replayed ? 200 : 201, body: result };
      } },
    { method: 'POST', path: /^\/api\/rides\/([a-f0-9-]{36})\/chat\/read$/, access: 'write',
      handle: ({ user, match, data }) => ({ body: chat.markRead(user.id, match[1], data) }) },
    { method: 'POST', path: /^\/api\/rides\/([a-f0-9-]{36})\/chat\/messages\/([a-f0-9-]{36})\/report$/, access: 'write',
      handle: ({ user, match, data }) => {
        const result = chat.report(user.id, match[1], match[2], data);
        return { status: result.replayed ? 200 : 201, body: result };
      } },
    { method: 'GET', path: /^\/api\/admin\/chat-reports$/, access: 'read',
      handle: ({ user }) => ({ body: { reports: chat.reports(user.id) } }) },
    { method: 'POST', path: /^\/api\/admin\/chat-reports\/([a-f0-9-]{36})\/review$/, access: 'write',
      handle: ({ user, match, data }) => ({ body: { report: chat.reviewReport(user.id, match[1], data) } }) },
  ];
}
