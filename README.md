# Taxi Ai

Rides, Taxi Ai Eats and courier delivery, starting in Abuja, Nigeria.

## What works today

This is the first engineering foundation, not a launched transport service.
It includes a runnable fare-negotiation domain module, automated tests and a
terminal demonstration. There are no external runtime dependencies.

The customer or driver can send an offer. The other participant can accept or
counter it. Accepting the current, unexpired offer records their agreed fare in
NGN. Suggestions are advisory. Chat and voice-call origins use the same explicit
offer/accept rules; chat messages and spoken agreements alone cannot set a fare.

**Not implemented yet:** the website, mobile apps, user accounts, actual chat or
calls, maps, dispatch, restaurant ordering, parcel tracking, AI models and payments.
The app and API directories contain planning notes, not working applications.

## Run locally

Install [Node.js 24 LTS](https://nodejs.org/en/download) if needed. From this
repository's directory:

```bash
node --version
npm test
npm run demo
```

No `npm install`, API keys or database are needed for this initial foundation.
If you use nvm, `nvm install` and `nvm use` select the version in `.nvmrc`.
There is no `npm run dev` command or browser interface in this milestone.

The demo negotiates a **fictional** Wuse II to Maitama fare and prints the final
agreement. Its prices are example inputs, not estimates of real Abuja fares.

## Project layout

| Path | Purpose | Status |
| --- | --- | --- |
| `packages/shared/src/fare-negotiation.mjs` | Fare offer and agreement rules | Implemented, tested in memory |
| `packages/shared/test/` | Business-rule tests | Runnable |
| `scripts/fare-demo.mjs` | Terminal example | Runnable |
| `apps/web/` | Responsive booking website and future vendor/admin portals | Planned |
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

The first module uses JavaScript ES modules to keep setup simple. A web/mobile
framework and TypeScript toolchain can be chosen when those applications begin.
No license has been selected for this private project.
