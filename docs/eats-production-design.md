# Taxi AI Eats: customer experience design

This is the production target for mobile and web. The current Eats preview now asks for a delivery address before dish and seller search, uses overhead Nigerian food photography, supports restaurant/vendor/private-kitchen location labels, and lets customers combine multiple items from one kitchen. Checkout still places test orders without charging. The tables below include additional production work that is not yet in the preview, including address validation, item customizations, delivery estimates, mixed-seller baskets, and real payments.

## 1. Page layout

| Surface | Mobile | Web |
| --- | --- | --- |
| Delivery location | First-run address sheet before the catalog. After confirmation, a persistent “Deliver to” control sits at the top. | Address dialog before search results; the confirmed address remains in the sticky header. |
| Discovery | Search field directly below the address, followed by a top-view Nigerian food hero, “Popular near you” dishes, cuisine chips, then matching menu items and sellers. | Search and address in the header, a wide editorial food hero, category rail, two- or three-column dish results, and a seller section. |
| Results | Dish-first cards show photo, dish name, price, seller, location label, availability, and total estimated arrival time. | The same content in a responsive grid with room for filters and a persistent basket. |
| Seller menu | Seller profile, location label, grouped menu, customization sheet, quantity control, and clear sold-out state. | Seller profile and menu in the main column; basket in a sticky right column. |
| Basket and checkout | Sticky basket button opens a full-screen basket; checkout uses an address confirmation and itemized totals. | Sticky basket panel opens a dedicated checkout page with itemized totals. |
| Tracking | One order-group page with a separate status card and ETA for each seller delivery. | The same grouped timeline, with a map when a courier has started sharing location. |

Visual direction: warm ivory backgrounds, charcoal type, Taxi AI amber for primary actions, generous white space, rounded cards, and restrained shadows. Replace emoji covers with licensed or commissioned overhead photos of jollof rice, egusi with pounded yam, suya, ofada rice, pepper soup, moi-moi, akara, and puff-puff. Use one wide top-view hero and dish-specific square or 4:3 thumbnails throughout discovery and menus. Label editorial photos as representative; use the seller's verified photo for a real menu item when available. Supply descriptive alt text, responsive crops, and optimized AVIF/WebP variants.

## 2. User flow

1. Enter a delivery street/building/landmark, choose an autocomplete result or map pin, and confirm the town and serviceability. GPS is an optional shortcut; the user still confirms the address.
2. Type a dish or craving, such as “jollof rice and chicken.” Search real, available menu items first, with seller matches as a second group. Filter by cuisine, price, dietary attributes that sellers have verified, preparation time, and delivery estimate. Empty states suggest related searches without inventing menu items.
3. Open a dish or seller menu, choose required variants/add-ons, and add quantities. The basket supports multiple items. For items from different sellers, group lines by seller and show each seller's minimum, delivery fee, ETA, and independent fulfillment status before checkout.
4. Review the confirmed address, item substitutions, allergy information, fees, and total. Revalidate every seller's hours, availability, item prices, service area, and delivery quote. Freeze an immutable, short-lived checkout quote in kobo.
5. Start hosted payment from the server. A return from the payment page shows “Confirming payment” until the server verifies the reference, amount, and currency. Only then confirm the order group and send seller notifications. If one seller cannot fulfill, show the affected order and refund/cancellation state clearly.
6. Track each seller order from accepted to preparing, courier pickup, and delivery. Provide help, cancellation eligibility, and receipt access from the same order-group page.

If a mixed-seller basket cannot be supported at launch, limit it visibly to one seller and explain that choice before replacing basket contents. Do not silently drop previously selected items.

## 3. Key components and module boundaries

| Component | Responsibility |
| --- | --- |
| `DeliveryLocationGate` | Typed address, suggestions, map confirmation, serviceability, saved addresses. |
| `FoodSearch` | Debounced dish/seller search, suggestions, result count, filters, and empty/error states. |
| `DishCard` / `SellerCard` | Consistent photo, price, availability, ETA, and seller location policy. |
| `SellerHeader` / `MenuSection` / `ItemCustomizer` | Seller identity, menu categories, required options, allergens, quantity. |
| `Basket` / `SellerBasketGroup` | Multi-item quantities, per-seller minimum and fees, unavailable-item recovery. |
| `CheckoutSummary` / `PaymentStatus` | Authoritative quote, total, hosted checkout handoff, pending/success/failure state. |
| `OrderGroupTimeline` | Per-seller progress, courier and support details, receipt. |
| `SellerLocationLabel` | One shared display policy for mobile and web; never receives private pickup fields. |

Keep shared validation, search-result and seller-display contracts in `packages/shared`. Keep seller identity, search, quotes, orders, payment reconciliation, and dispatch in separate backend modules. The web and mobile clients should use the same public response shapes and totals while rendering platform-specific navigation. Keep merchant/admin editing outside the customer discovery component tree.

## 4. Data structure suggestions

```text
DeliveryAddress { id, customerId, label, line1, landmark?, town, areaId, lat, lng,
                  instructions?, verifiedAt }
Seller { id, type: restaurant | vendor | private_kitchen, displayName, town,
         publicAddress?, privatePickupAddressId, serviceArea, status, isOpen,
         prepMinutes, ratingSummary?, heroImageId? }
MenuItem { id, sellerId, name, description, category, priceKobo, currency: NGN,
           available, optionGroups[], dietaryClaims[], imageId?, searchTerms[], version }
Basket { id, customerId, deliveryAddressId, groups: [{ sellerId, lines: [{ itemId,
         quantity, selectedOptions[] }] }] }
CheckoutQuote { id, basketId, addressSnapshot, sellerGroups[], subtotalKobo,
                deliveryFeeKobo, serviceFeeKobo, totalKobo, currency: NGN,
                expiresAt, catalogVersions[] }
OrderGroup { id, customerId, quoteId, paymentAttemptId, totalKobo, status }
SellerOrder { id, orderGroupId, sellerId, itemSnapshots[], pickupAddressId,
              deliveryAddressId, status, courierId?, deliveryFeeKobo, events[] }
PaymentAttempt { id, orderGroupId, provider, providerReference, expectedAmountKobo,
                 currency, status, idempotencyKey, verifiedAt? }
```

For `restaurant`, the customer projection contains `displayName` and `publicAddress` with the full business address. For `vendor` and `private_kitchen`, it contains only `displayName` and `town`; `publicAddress` is absent, not merely hidden by CSS. Store the precise pickup address separately and release it only to authorized seller staff, dispatch, and the assigned courier when needed. The customer search index must exclude private pickup address text and coordinates.

Suggested customer API: `POST /eats/delivery-locations/validate`, `GET /eats/search?q=&addressId=`, `GET /eats/sellers/:id`, `POST /eats/checkout-quotes`, `POST /eats/payment-attempts`, and `GET /eats/order-groups/:id`. Cursor-paginate results; cache public menus and images, while treating prices, availability, and totals as server-authoritative. Keep idempotency keys for checkout and order creation, and deduplicate payment webhooks.

## 5. Mobile and web behavior

- Mobile uses a location sheet, single-column dish list, full-screen item customizer, sticky basket CTA, and native back navigation that preserves the draft basket. Web uses an address modal, keyboard-accessible search suggestions, responsive grid, sticky basket, and a checkout route that survives refresh.
- Changing the delivery location clears stale delivery estimates and requests new serviceability/search results; changing a menu option invalidates the checkout quote on both platforms.
- Both platforms show loading skeletons, offline/retry states, sold-out and closed-store states, payment pending, and recovery for a quote that expires or changes. A payment callback alone does not mark an order paid.
- Both platforms use clear focus states, 44-pixel or larger tap targets, semantic labels, reduced-motion support, and text alternatives for food photos. Never encode availability or seller type by colour alone.
- Storefront and kitchen tools can continue to reuse the existing Eats order lifecycle, but customer-facing seller projections, a menu search endpoint, grouped baskets/orders, and real payment state need new contracts and migrations.

For a Nigeria launch, a hosted provider such as Paystack can take the payment details while Taxi AI initializes each transaction on the server and verifies its status and amount before fulfilling an order. Verify webhook signatures and process events idempotently. Paystack documents the server initialization, verification, and webhook flow in its [Accept Payments](https://paystack.com/docs/payments/accept-payments/) and [Webhooks](https://paystack.com/docs/payments/webhooks/) guides. The PCI Security Standards Council's [payment-page guidance](https://www.pcisecuritystandards.org/faqs/if-a-merchant-s-e-commerce-implementation-meets-the-criteria-that-all-elements-of-payment-pages-originate-from-a-pci-dss-compliant-service-provider-is-the-merchant-eligible-to-complete-saq-a-or-saq-a-ep/) reinforces keeping card-entry elements with a compliant provider.
