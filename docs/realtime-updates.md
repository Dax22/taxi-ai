# Live account updates

The browser dashboard, Eats page, and native iOS/Android client use one authenticated, account-scoped long-poll channel per active page/app. The channel carries only `{ cursor, changed }`. Clients read authorized domain endpoints when their own account revision changes.

- Browser: `GET /api/events?cursor=0&wait=25000`, same-origin session cookie.
- Native: `GET /api/mobile/v1/events?cursor=0&wait=25000`, bearer access token.
- `cursor` is a decimal string so database counters do not lose precision in JavaScript.
- `wait` is an integer from 0 through 25000 milliseconds. The server rejects additional fields, including user IDs.
- Sessions are checked before the wait and again before returning the response.

## Consistency and scaling

Migration 028 stores one `account_revisions` row per affected account. Database triggers increment revisions in the same transaction as ride/trip, driver offer, chat, call signaling, trip position, order, payment, notification, driver approval, and relevant safety changes. A rollback also rolls back its invalidations. Each trigger targets the record's participants or owner; order changes also target the store owner. No message body, location, phone number, session token, or other private payload is copied into the revision table.

Each API instance performs one shared revision check per second while subscribers exist. Checks cover only connected account IDs, in indexed chunks of 250, rather than loading each subscriber's application state every three seconds. All instances observe the shared database; sticky sessions are unnecessary. This is durable invalidation with bounded shared polling, not a Redis/PubSub or PostgreSQL LISTEN/NOTIFY service.

The default service bounds are 10,000 pending requests per instance and four per account per instance. A deployment must size proxy connections and file descriptors from measured load. Long-poll connections must have a proxy read timeout greater than 25 seconds. These bounds are safeguards, not a demonstrated user-capacity claim.

## Client behavior

Only one event request is outstanding per channel. Account changes reset the cursor; backgrounding aborts the active request and cancels timers. Resuming retains the same account's cursor, so events committed while disconnected are recovered. Failed refreshes do not acknowledge their revision. Reconnection uses exponential backoff with jitter up to approximately 30 seconds.

A 30-second fallback refresh reconciles state when connectivity is unreliable or a screen displays catalog/admin listings that are not individually fanned out. Catalog updates deliberately do not increment every user's account revision. Anonymous pages use a slow session check. Existing explicit refresh controls remain available.

GPS publication and driver availability heartbeats remain independent of the invalidation loop. Active voice media retains its signaling/keepalive polling. Experimental foreground safety monitoring retains its short, targeted refresh because that controller also renews sensor consent and displays a countdown; it is not a broad dashboard poll.

## Verification

Tests cover cross-instance revisions, account isolation, strict query parsing, authorization after session revocation, disconnect cleanup, per-account limits, transaction rollback, reconnection cursors, stale-account responses, retry backoff, browser cancellation, and native background/logout cancellation. Infrastructure capacity still requires load testing with realistic locations, trips, matching, and concurrent connections.
