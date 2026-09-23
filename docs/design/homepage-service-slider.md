# Landing-page service slider

The full-width landing-page artwork rotates automatically every 6.5 seconds.
It starts with the unchanged overhead city/taxi artwork, followed by airport drop-off,
food delivery and the graphite sedan against an Abuja-inspired map background.

## Current artwork

All files are in `apps/web/public/assets/`. Desktop WebP versions are 1774 × 887;
small versions are 960 × 480. New variants use query version `v=2` in the page
to refresh cached images.

| Scene | Desktop file | Small file |
| --- | --- | --- |
| Original city rides | city-route-hero.webp | city-route-hero-small.webp |
| Airport with realistic people and car aligned with lane | airport-dropoff-hero.webp | airport-dropoff-hero-small.webp |
| Food handoff with realistic people | food-delivery-hero.webp | food-delivery-hero-small.webp |
| Graphite sedan left of centre, Abuja-inspired map | courier-delivery-hero.webp | courier-delivery-hero-small.webp |

The airport and food people are AI-generated photorealistic people, not photographs
of actual staff or customers. The courier car reference is the graphite sedan from
the earlier landing-page `taxi-hero.webp`, recovered from the existing project
snapshot. The Abuja background is an artistic map illustration, not navigation data.
These are concept scenes, not evidence of live service availability.

The built-in image-generation tool produced all three revised PNGs. Sharp exported
the WebP assets at quality 84. The original generated PNGs remain intact.

## Interaction and layout

`apps/web/public/homepage-carousel.mjs` is loaded only by the landing page and
does not access booking state. The service selector buttons and controls row beneath
the images are removed. Compact pause/play and previous/next controls sit over the
top-right of the image. All controls have accessible names and 44-pixel touch targets.

Rotation begins automatically; a stationary mouse does not stop it. Keyboard focus
and manual navigation stop rotation until Play is selected. A hidden browser tab
temporarily suspends rotation. Reduced-motion settings disable automatic rotation
and animation; the overlay arrows allow manual browsing. Automatic changes are not
announced to screen readers. Without JavaScript, the first scene stays visible.

Artwork reaches both edges of the page with no side gutters, maximum-width cap or
image distortion. Images retain a 2:1 ratio. Heading and booking content retain their
normal spacing.

## Verification

Nine focused carousel and server checks pass, including automatic looping, hover,
visibility, focus, pause/play, reduced motion, manual browsing and asset serving.
The repository syntax/import/dependency check passes for 294 JavaScript modules.
Browser/device layout remains unverified because the available browser cannot open
the local preview.

## Current image-generation prompts

### airport

Use case: precise-object-edit. Edit the supplied Taxi AI airport hero. Keep a wide 2:1 landscape format, elegant white architectural airport environment, sage landscaping, yellow sedan, airy premium CGI surroundings and natural shadows. Essential change 1: the sedan must be aligned PARALLEL to the straight curb and painted road lane lines, its longitudinal front-to-rear axis following the lane direction, not diagonal across the lane. Nose points toward the right upper side, travelling along the road. Show a front/side three-quarter view with the car parked in the curbside stopping lane. The rear passenger door on the sidewalk side is open. Driver, passenger and luggage trolley stand safely on the sidewalk next to that door, not in traffic. Essential change 2: replace the miniature/cartoon people with convincingly PHOTOREALISTIC adult humans: natural adult proportions, anatomically correct hands, detailed skin texture, real hair, realistic fabric, professional Black male chauffeur in a dark suit and adult Black female traveller in a light elegant outfit. Their height and scale must be correct relative to a real sedan. Faces read as photography, not cartoon, plastic, dolls or 3D figurines. Lighting, perspective and contact shadows integrate them seamlessly with the premium white CGI airport. Keep complete car, both people and luggage comfortably in frame. Landscape 2:1. No text, logos, watermark, UI or borders.

### food

Use case: style-transfer. Edit the supplied Taxi AI food delivery illustration. Keep the wide 2:1 scene layout and white-and-yellow brand environment: modern white residence, sage landscaping, graphite road in background, yellow delivery bag, bicycle and a takeaway food bag handoff. Essential change: replace BOTH cartoon figures with PHOTOREALISTIC adult people who look like a real lifestyle photograph, natural adult proportions, realistic faces and skin pores, real textured hair, lifelike hands, believable fabric drape, no doll or animated-movie facial design. A friendly adult Black male courier with a realistic yellow safety helmet and jacket hands a tan paper takeaway bag to an adult Black woman in casual warm-weather clothing at her open doorway in Nigeria. Both have natural expressions and their hands correctly hold the bag handles. She is beside the door with her whole body visible; he stands next to a realistic bicycle with a yellow insulated delivery box. Maintain white sculptural architectural surroundings and restrained sage greenery, soft natural light, physically plausible perspective and shadows, full scene edge-to-edge landscape 2:1. Human subjects must look REAL, not clay, plastic, toy, cartoon, illustration or rendered figurines. No text, logos, watermark, UI or borders.

### courier

Use case: compositing. Asset type: Taxi AI full-width landing-page courier service slide, landscape 2:1. Image 1 is the EXACT CAR reference: preserve that graphite electric sedan's body shape, paint, dark glass, realistic wheels and front three-quarter view. Reuse this car as the foreground focal point, shifted modestly LEFT of centre at about 36% of image width, complete car and all visible wheels in frame. The car should occupy about 45% of the canvas width. Replace the original concrete building background with a beautiful decorative ABUJA city map background. Image 2 is the STYLE reference for the map: near-white architectural relief, tiny white city blocks and road grid, subtle sage-green parks, graphite route with warm yellow markers. Make a wide aerial map-like diorama of Abuja, Nigeria with an abstract central district street network and Aso Rock suggested at far back right; an artistic city-map backdrop, not a precise navigation map. Map cityscape recedes behind and to the right of the car. Foreground car is realistic and slightly elevated above the softer-scale map relief, grounded with natural shadows. White, graphite, muted sage and restrained yellow #F4B400 accents. Keep the car graphite, not yellow; preserve its appearance from image 1. No humans required. Full-bleed 2:1 landscape with artwork reaching both left and right edges, gentle off-white top fade, polished premium mobility advertising. No labels, text, branding, watermark, UI, arrows outside the map, panels or border.
