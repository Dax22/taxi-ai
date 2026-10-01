# Photographic page layouts

The October 2026 website refresh uses warm white cards, graphite photo headers, amber controls and Manrope. Generated scenes illustrate the service; they are not merchant menu photos, verified kitchens, actual drivers, live availability or geographically accurate maps.

## Assets and generation

Created with the built-in image-generation tool. Four original landscape scenes were generated at 1536 × 1024 and exported as metadata-free WebP at quality 82. Each has a 768 × 512 small variant. Originals remain in the generation workspace; deployable assets are committed under `apps/web/public/assets/scenes/`.

### ride-city

Files: `ride-city.webp` and `ride-city-small.webp`.

Prompt:

> Use case: photorealistic-natural. Create a premium editorial photograph for Taxi Ai's Nigerian ride booking website background, landscape 3:2. A real-looking Nigerian woman passenger with a small handbag smiling beside a tasteful modern yellow sedan at an Abuja urban avenue, green trees and modern city architecture softly blurred. Car parked sensibly at the curb, woman standing safely on sidewalk next to rear passenger door, natural proportions. Subject occupies right half, calm darker uncluttered street/foliage on left for a large white headline. Golden late-afternoon light, warm amber and deep forest/graphite palette, filmic but convincingly photographic, tasteful luxury travel magazine, natural skin texture. No text, logos, badges, watermarks, interface, or fake readable plate. Not a collage, not illustration, no 3D render.

### eats-table

Files: `eats-table.webp` and `eats-table-small.webp`.

Prompt:

> Use case: photorealistic-natural. Landscape3:2 premium Nigerian food editorial photograph, genuinely overhead flat lay. Beautiful jollof rice with grilled chicken and plantain, bowl of egusi and pounded yam, suya skewers with onion, moi moi and puff puff on ceramic dishes arranged generously across a dark textured walnut table, deep forest linen, restrained warm gold details. Food mostly across right two-thirds, quieter dark tabletop on far left for white website headline. Real texture, appetizing fresh food, soft warm side lighting, sophisticated restaurant magazine photography, harmonious composition and believable portions. No people, no words, logos or watermarks. Full bleed photograph, not a collage or UI.

### courier-handoff

Files: `courier-handoff.webp` and `courier-handoff-small.webp`.

Prompt:

> Use case: photorealistic-natural. Create landscape3:2 editorial photograph for Nigerian parcel delivery website. A friendly Black Nigerian courier in a clean mustard-yellow polo handing a medium sealed cardboard parcel with both hands to a smiling Nigerian woman at the gate of a tasteful modern home. A parked motorcycle with plain delivery case softly visible at right, no ride in progress, no unsafe behavior. Subjects grouped on right half, left half softly shadowed textured residential wall and tropical leaves for website white headline. Late-afternoon warm light, natural realistic faces/hands, refined contemporary lifestyle photography, deep forest and amber accents. No logos, text, watermarks, symbols, UI. Single realistic photo, no illustration.

### kitchen

Files: `kitchen.webp` and `kitchen-small.webp`.

Prompt:

> Use case: photorealistic-natural. Landscape3:2 premium editorial lifestyle photograph for a Nigerian home cook and restaurant seller website. A confident Nigerian woman cook in a deep olive apron plating fresh jollof rice, grilled chicken and plantain at a clean professional-looking compact kitchen counter, gentle genuine smile, natural skin/hands, bright stainless details and warm wood, ingredients tidy. Person and plated food on right two-thirds; left third darker softly focused kitchen cabinetry leaves useful quiet space for a white website headline. Warm natural window light, rich food color, inviting dignified independent food business story, sophisticated editorial photography. No logos, writing, watermark, UI, or collage.

## Integration

- Homepage: four service scenes, existing navigation and mobile-phone artwork; new photograph cards below.
- Account/booking: photo sign-in panel and compact journey banner; selecting Courier updates only the banner theme.
- Eats: food discovery and kitchen seller themes. Delivery forms remain on opaque cards, and merchant photos retain their independent review/provenance rules.
- Supporting pages: compact photo headers for parcels, family, devices, account access/recovery and shared/guest trips.

`page-scenes.mjs` is presentation-only. It has no API, credentials, geolocation or operational dependencies. It changes decorative images every 11 seconds, preloads only the next image and retains the current image on failed loads. Controls pause rotation on focus/manual changes, respect reduced-motion preferences, and stop timers when the page or scene is hidden. New scene themes preserve an explicit pause. No-JavaScript pages retain their initial image and operational markup.

Native app layouts are unchanged in this website refresh. Account, booking, order, payment and tracking logic and database schemas are unchanged.

