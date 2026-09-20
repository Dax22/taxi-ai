# Taxi Ai staff dashboard — planned

This directory reserves the separate staff application requested for operations,
support, safety and finance. **There is no admin dashboard runtime here yet.**
The current prototype's limited driver-review, reported-chat, payment and SOS
screens remain in the existing web account UI.

Build against [the admin dashboard plan](../../docs/admin-dashboard.md), using
staff-only authentication and narrowly scoped backend permissions. Public native
sessions must never grant staff access. Keep staff roles out of the customer app's
Customer/Work/My store switcher. Reuse domain services through the composition
root; do not duplicate bookings or connect the browser directly to the database.
