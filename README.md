# Taxi Ai

Rides, Taxi Ai Eats and courier delivery, starting in Abuja, Nigeria.

## What works today

This is a product preview, not a launched transport service. It includes a
responsive website, an interactive ride/fare demo, shared fare-negotiation rules,
25 automated tests and a terminal demonstration. There are no external runtime
dependencies.

The customer or driver can send an offer. The other participant can accept or
counter it. Accepting the current, unexpired offer records their agreed fare in
NGN. Suggestions are advisory. Chat and voice-call origins use the same explicit
offer/accept rules; chat messages and spoken agreements alone cannot set a fare.

The browser demo lets you select sample Abuja areas, swap the route, view a
fictional suggested fare, switch between customer/driver, counteroffer, accept or
cancel. The fare expires after two minutes. Closing the demo or refreshing the
page discards its in-memory state.

**Not implemented yet:** mobile apps, user accounts, actual chat or calls, live
maps, dispatch, restaurant ordering, parcel tracking, AI models and payments.
Eats, courier and autonomous taxis have informational sections only. Native app
and API directories remain planning placeholders.

## Run locally

Use Node.js 22.12 or later. Node.js 24 is the version selected by `.nvmrc` for
new setups. From this repository's directory:

```bash
node --version
npm test
npm run dev
```

Open **http://localhost:3000** in your browser. Keep the terminal running; press
**Ctrl+C** to stop the server. If port 3000 is occupied, use
`PORT=3001 npm run dev` and open http://localhost:3001.

The original terminal demo is also available:

```bash
npm run demo
```

No `npm install`, API keys or database are needed for this preview.
If you use nvm, `nvm install` and `nvm use` select the version in `.nvmrc`.

The sample prices are **fictional** inputs, not estimates of real Abuja fares.
The local server binds to this computer only. It is a development preview, not a
production hosting setup or a shared multi-user service.

## Project layout

| Path | Purpose | Status |
| --- | --- | --- |
| `packages/shared/src/fare-negotiation.mjs` | Fare offer and agreement rules | Implemented, tested in memory |
| `packages/shared/test/` | Business-rule tests | Runnable |
| `scripts/fare-demo.mjs` | Terminal example | Runnable |
| `apps/web/` | Website, local server and interactive ride demo | Implemented preview; vendor/admin portals planned |
| `apps/customer/` | iOS/Android customer app, including tablets | Planned |
| `apps/driver/` | Driver and delivery rider app | Planned |
| `services/api/` | Authenticated backend and integrations | Planned |
| `docs/` | Requirements, architecture and milestones | Written |

Read [the requirements](docs/requirements.md), [architecture](docs/architecture.md)
and [roadmap](docs/roadmap.md) before adding features.

## Development

Use a branch and a pull request for each change. Run `npm test` before opening a
pull request. Keep example accounts and fares clearly marked as demonstration data.
Do not commit secrets or customer information.

This preview uses browser-native HTML/CSS/JavaScript and the same ES-module domain
rules as the tests. A web/mobile framework and TypeScript toolchain can be chosen
when the authenticated applications begin.
No license has been selected for this private project.
