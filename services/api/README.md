# Backend API (planned)

Reserved for authenticated accounts, driver onboarding, bookings, dispatch,
food orders, courier jobs, private communication and payments.

The first reusable domain module is
[`FareNegotiation`](../../packages/shared/src/fare-negotiation.mjs).
It is not an API, database or authentication system. Follow the transaction and
permission requirements in [the architecture notes](../../docs/architecture.md)
before exposing it through network endpoints.
