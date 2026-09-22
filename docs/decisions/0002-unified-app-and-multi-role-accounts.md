# ADR 0002: Unified app and accounts with multiple capabilities

Status: accepted; account/web foundation implemented, broader platform planned.

## Context

The user wants one Taxi Ai app for iOS/Android and one website supporting rides,
Eats and courier. A person may be a customer, passenger driver, delivery worker
and food-vendor member. The current prototype requires one `users.role`, and
registration, services and the web page controller depend on it. The native
customer/driver directories are planning placeholders.

## Decision

Use one mobile application at `apps/mobile/`, the existing web client and a shared
backend. Provide Customer, Drive & deliver and My store modes. Let one personal
identity hold several separately approved service capabilities and scoped store
memberships. Keep administrator access outside the public mode picker.

Treat modes as client navigation, not authorization. Authorize each action using
current grants, membership, resource relationships and state. Keep active work
and capacity server-owned across sessions, modes, devices and services. Partition
client state by acting context and discard stale responses during transitions.

Retain ADR 0001's modular monolith. Keep ride, food and courier workflows distinct
and connect shared workload, payments, communications and safety through explicit
ports. Share contracts and suitable pure logic across clients; keep platform
views, permissions and device adapters where needed.

React Native with Expo and TypeScript is the proposed mobile implementation.
The working website does not need a framework rewrite to participate. Document
mobile authentication and API contracts before connecting native clients.

Implement account migration and the web mode shell first; develop the single
mobile foundation alongside stable contracts. Add courier and Eats end-to-end
flows in subsequent releases. See [the product and reliability plan](../unified-platform.md).

## Consequences

- Users can buy, work or manage a store through the same account and product.
- Role-sensitive navigation reduces clutter while retaining access to other
  approved activities and a persistent return path to active work.
- One app increases permission, device-lifecycle and cross-context test coverage.
  Feature loading and service flags help manage bundle size and release scope.
- Vendor membership needs business/store scoping; it cannot be represented by a
  global `vendor` flag. Driver and delivery permissions need vehicle eligibility.
- Multiple capabilities require explicit self-assignment and cross-service
  workload checks that separate-account assumptions previously obscured.
- Backend and UI changes must preserve existing records through a forward
  migration and a reviewed compatibility/cutover plan.
- Browser and native device capabilities differ. Continuous work tracking and
  background audio require platform-specific implementation and validation.
- Shared process/database failures can still affect multiple services. Reliable
  operations require observed performance, recovery drills and staffed support.

## Implementation status

The original decision was documentation-only at version 0.13.2/schema 9.
Version 0.14.0/schema 10 implements Customer/Work on the website, additive public
capabilities and driver enrollment under the same login. Staff remains separate.
See [the account implementation](../unified-accounts.md). The native app now includes authentication and ride/parcel workflows. Version
0.24.0 adds Eats and one scoped owner/store membership per personal account.
See [Eats](../eats.md) for implemented scope and remaining production work.
