# Taxi Ai mobile application (planned)

One mobile product for iOS and Android, with phone and tablet layouts. It will
use the same account, services and saved activities as the Taxi Ai website.

Modes within this application:

- Customer: rides, Taxi Ai Eats and courier purchases.
- Drive & deliver: passenger or delivery work enabled by service/vehicle approval.
- My store: food-vendor operations limited by store membership and permissions.

The proposed stack is React Native + Expo + TypeScript. Keep navigation, shared
components and API adapters separate from feature screens and platform-specific
location, calling, notification and secure-storage adapters. Share reviewed API
contracts and pure business helpers with the existing project where appropriate.
The backend remains responsible for authorization, agreement and activity state.

The first implementation follows multi-capability accounts and the native
authentication/API contract. Customer and worker ride flows come before courier
and vendor ordering. See [the unified platform plan](../../docs/unified-platform.md)
and [ADR 0002](../../docs/decisions/0002-unified-app-and-multi-role-accounts.md).

This directory replaces the former customer/driver planning placeholders. It is
not yet a runnable native app. Do not add a second role-specific mobile app.
