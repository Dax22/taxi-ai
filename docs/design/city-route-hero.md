# City-route homepage artwork

The user requested replacing the homepage's large car image with a bright,
minimal mobility theme inspired by their supplied reference image.

## Implemented direction

- A centered headline, dark rounded call to action and a soft white canvas.
- An original 3D city scene with white buildings, sage parks, a small yellow taxi,
  a graphite route and amber location-pin accents.
- The existing yellow Taxi Ai emblem and amber booking controls.
- The interactive fare preview below the scene, with side-by-side fields on
  desktop and stacked fields on narrow screens.
- Existing Eats, courier and autonomous-service availability labels remain visible.
  The illustration is explicitly described as conceptual, not a real route map.

## Files and delivery

| Asset | Dimensions | Format | Size |
| --- | --- | --- | --- |
| `apps/web/public/assets/city-route-hero.webp` | 1774 × 887 | WebP | 96,692 bytes |
| `apps/web/public/assets/city-route-hero-small.webp` | 960 × 480 | WebP | 41,694 bytes |

The homepage uses `<picture>` to choose the smaller file up to 800px. Both versions
preserve the complete route and both pins. Artwork is served locally through the
existing static allowlist, with no external image host or new dependency.
The old `taxi-hero.webp` image and its static route have been removed.

`apps/web/public/homepage.css` owns the revised hero/booking presentation. Shared
styles retain the reusable controls and page sections. Account and safety screens
do not load the homepage stylesheet. The update changes no booking, fare, payment
or safety rules.

## Generation

Method: built-in image generation, producing original artwork rather than editing
the user's screenshot. The screenshot guided the theme; no Urban/Uber branding,
text or controls were copied. ImageMagick exported the selected generation as
WebP and resized the small delivery variant without changing its composition.
No CLI image-generation API or API key was used.

Final generation prompt:

> Use case: stylized-concept. Asset type: original wide website hero illustration for Taxi Ai, a ride-sharing preview for Abuja. Create a polished, minimal 3D clay-render city map in a wide 2:1 landscape composition, inspired by contemporary white mobility website illustrations. This is illustration artwork ONLY, not a screenshot or website mockup. Show an airy isometric miniature neighbourhood on a soft near-white seamless background (#f8f9f7). Pale grey blocks, elegant low-rise white buildings, wide white cross streets, a few muted sage-green pocket parks and simple sculptural trees. A bold, smooth graphite-black route with subtle amber-yellow dashed markings runs diagonally across the central/lower scene from left foreground to right middle distance and makes a clean rounded turn, connecting two upright black location pins with amber-yellow centres. Place a small tasteful amber-yellow taxi on this route and two much smaller neutral silver cars on other streets. The vehicles should be small map elements, not the dominant subject. Make the city spacious and refined, with convincing soft ambient occlusion, matte materials, quiet architectural detail and gentle studio shadows. Camera: orthographic isometric, high angle; composition reads as an open city landscape with the full route and both pins clearly visible inside the central 85 percent, with breathing room at edges. The top quarter gently fades to a plain near-white background to blend into page typography ABOVE this artwork; the bottom also has soft white breathing room. White/grey dominate; yellow #F4B400 is the distinctive brand accent, with restrained sage vegetation and a hint of pale blue water at far right if composition permits. No giant automobile, no car showroom, no photorealism, no realistic satellite map, no people, no logos, no words, no text, no UI panels, no interface cards, no labels, no buttons, no watermark. High-end original 3D editorial illustration, crisp geometry and clean route, desktop/tablet/mobile hero use.

## Verification

The exported artwork was inspected, HTML IDs/fragment targets and local asset
paths were validated, and the stylesheet rules were reviewed. The existing
static-serving and full project checks pass: 216 tests and 147 module checks.
Real browser layout/interaction checks at 390, 768 and 1440px remain a manual
acceptance item: the available cloud browser previously blocked local preview
access. Source and HTTP checks are not a claim of browser/device testing.
