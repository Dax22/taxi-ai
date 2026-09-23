# Landing-page service slider

The landing page keeps the existing high-angle city/taxi illustration as the first
scene and adds airport drop-off, food delivery and courier delivery. The two supplied
photos are subject references for new 3D artwork, not photographs displayed on the page.

## Assets

All assets are served locally from `apps/web/public/assets/`. Desktop assets are
1774 × 887; small variants are 960 × 480. The original city artwork is unchanged.

| Scene | Desktop file | Small file |
| --- | --- | --- |
| City rides | city-route-hero.webp | city-route-hero-small.webp |
| Airport drop-off | airport-dropoff-hero.webp | airport-dropoff-hero-small.webp |
| Food handoff | food-delivery-hero.webp | food-delivery-hero-small.webp |
| Courier delivery | courier-delivery-hero.webp | courier-delivery-hero-small.webp |

New PNG sources were created with the built-in image-generation tool. WebP export
uses Sharp at quality 84. New desktop files total 349,172 bytes; the small versions
total 154,878 bytes. These assets are illustrations, not evidence of service availability.

## Component

`apps/web/public/homepage-carousel.mjs` is loaded only by the landing page.
It does not read or change booking state. The first image remains visible without
JavaScript. The slider has named scene selectors, previous/next buttons, a pause/play
control, and no automatic rotation or transition animation when reduced motion is set.
Keyboard focus and manual navigation stop automatic rotation; hover and a hidden
browser tab suspend it. Scene changes preserve the image area's aspect ratio.

The artwork spans the full page width, with no maximum width or side gutters on
desktop or mobile. The heading, controls and booking form retain their normal
content spacing. Percentage widths avoid horizontal overflow from scrollbar width;
all scenes keep their 2:1 proportions without stretching.

Manual checks: visit `/` on desktop and a phone-sized viewport, select each scene,
navigate with Tab and Enter, pause/resume, and enable reduced motion. Confirm the
booking form below still works independently. Browser visual verification is pending
because the available browser could not open the local preview.

Verified: all 13 carousel, static-route and demo-booking tests pass. The repository
check passes syntax, imports, dependency boundaries and cycle checks for 294
JavaScript modules. Browser/device rendering is not claimed as verified.

## Image generation prompts

Image 1 in each prompt is the original city/taxi artwork. Image 2 is the corresponding
user-supplied subject photograph.

### Airport drop-off

Use case: stylized-concept. Asset type: Taxi AI landing-page carousel illustration, wide 2:1 landscape. Create an original airport passenger drop-off scene as a polished miniature 3D clay diorama. Image 1 is the STYLE reference: preserve its white miniature architecture, near-white #f8f9f7 seamless background, matte surfaces, restrained sage trees, warm yellow #F4B400 accents, graphite route, soft ambient occlusion and high-angle orthographic/isometric view. Image 2 is the SUBJECT reference only: driver holding open a sedan door for an adult woman with luggage outside an airport terminal. Reinterpret this action as tasteful stylized 3D adult figures, not photography. Show a yellow sedan with one open rear passenger door at a safe airport curb, a dark-clothed miniature chauffeur and adult passenger with luggage trolley; all well formed and clearly recognizable. A sculptural white airport terminal and small distant white airplane provide context. Composition closer than image 1 so the passenger interaction is legible, with subjects comfortably inside central 75%, enough white city context and margins for responsive cropping. Charcoal road with restrained dashed yellow lines. Landscape 2:1, cohesive premium architectural miniature illustration, top and bottom fade into near-white. No text, UI, words, logos or watermarks. No photorealistic people.

### Food delivery

Use case: stylized-concept. Asset type: Taxi AI landing-page carousel illustration, wide 2:1 landscape. Create an original food delivery handoff scene as a polished miniature 3D clay diorama. Image 1 is the STYLE reference: preserve white miniature architecture, near-white #f8f9f7 seamless background, matte surfaces, sage trees, yellow #F4B400 accents, graphite route, soft ambient occlusion and high-angle orthographic/isometric camera. Image 2 is the SUBJECT reference only: helmeted bicycle courier hands a paper takeaway food bag to an adult woman in the doorway of her home, bicycle and insulated delivery bag nearby. Reinterpret as tasteful stylized miniature 3D adult figures, not photography. Friendly courier in yellow helmet and jacket, recipient at open white doorway, tan paper food bag visibly held between them, a small yellow insulated delivery container and complete bicycle safely standing beside the porch. White neighbourhood architecture and gentle sage landscaping, hint of a dark road with yellow route markings, warm details at house. Composition closer than image 1 so exchange is clear within central 75%, comfortable margins. Balanced 2:1 landscape, high-end original miniature architectural illustration, white predominates, top and bottom fade into near-white. No words, text, logos, UI or watermarks. No realistic people.

### Courier delivery

Reused the already generated courier illustration from the preceding slider work:
high-angle white miniature city, warehouse with parcels, a white/yellow van and a
motorcycle along a graphite route with yellow dashes connecting two location pins.
The preceding generation prompt is not available in the current execution context.
