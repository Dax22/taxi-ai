# Taxi Ai brand

Selected direction: **Option 03 — Amber & Graphite / City in Motion**.
The user selected the yellow forward-motion concept.

## Colour palette

| Use | Colour | Hex |
| --- | --- | --- |
| Logo mark, primary buttons and selected controls | Amber yellow | `#F4B400` |
| Wordmark, body text and dark sections | Graphite | `#202225` |
| Account/shared page background | Pale stone | `#F6F5F0` |
| Homepage background | Soft white | `#F8F9F7` |
| Button hover | Deep amber | `#DDA300` |
| Soft selected backgrounds | Pale amber | `#FFF3CE` |
| Focus outlines and small accents on light surfaces | Dark amber | `#805400` |

Use graphite lettering on yellow buttons. Keep yellow text for dark backgrounds;
do not use pale yellow for small body copy on white. Do not rely on colour alone
to communicate selection: tabs retain an underline, buttons have visible state
changes, and accessible state attributes remain in place.

## Typography

App typography follows the native system font consistently: iOS uses System
(San Francisco), Android uses `sans-serif` (Roboto), and web/admin use `system-ui`
with platform fallbacks. This preserves the mobile app's existing font choice;
it does not promise identical glyphs across operating systems. Native text uses
`src/ui/typography.tsx`, including form and navigation labels. Web styles import
`typography.css`; no external font download is required. Sizes and weights retain
their heading/body hierarchy and native text scaling.

## Logo assets

- `apps/web/public/assets/taxi-ai-mark.svg`: clean vector reconstruction of the
  approved forward-motion emblem for the website's header and footer.
- `apps/web/public/favicon.svg`: the same emblem in graphite on a yellow rounded
  square for the browser tab.
- The website combines the vector symbol with live, bold `Taxi Ai` text. Keep the
  capital T, capital A, lowercase i and a space between the two words.

The SVG implementation follows the selected concept and keeps the symbol sharp
at small sizes. It is a web adaptation of the generated concept, not a font-outline
export of the original presentation board. Both SVG files share the same two paths.

Keep the same master mark for Taxi Ai Eats and Taxi Ai Courier. Use their complete
service names in text, maintaining the common yellow/graphite palette.

## Applied in this version

The header and footer, favicon, browser theme colour, booking buttons, service-tab
selection, preview-role selection, step badges and confirmation accents use the
selected identity. The homepage uses a centered graphite headline and dark pill
CTA above an original white 3D city illustration. Small yellow vehicles and route
pin accents connect it to Taxi Ai's identity; muted sage parks soften the scene.
The original large sedan photograph is removed. The fare preview sits below the
illustration and stacks its fields on mobile. The hero's styles live in
`apps/web/public/homepage.css`, separate from the account/dashboard presentation.

The city scene is conceptual artwork, not a live or geographically accurate map.
Keep the illustration label and preview/coming-soon service states. See
[the artwork notes](design/city-route-hero.md) for the source prompt and exported assets.

The autonomous section continues the light 3D theme. Its compact robotaxi uses
yellow panels and sensor accents, with a man beside it using the app on an iPhone.
Keep both subjects fully visible and preserve the image's 3:2 proportions using
automatic height; do not stretch or crop it to fill a fixed box. A readable
coming-soon badge and concept caption accompany the scene. See
[the autonomous artwork notes](design/autonomous-concept.md) for its prompt and files.

Branding changes do not enable live bookings, food orders, courier dispatch,
communications, payments or autonomous rides.

## Vehicle identity cards

Vehicle cards use the same amber/graphite interface with realistic front
three-quarter PNG cutouts and the registered solid colour from a bounded palette. The
number plate is selectable text, separate from the artwork. Unknown or two-tone
colours use a clearly labelled neutral illustration. The illustration is not an
exact make/model render. Web assets live in `apps/web/public/assets/vehicles/`;
identical native files are bundled in `apps/mobile/src/assets/vehicles/`. The
transparent landscape sources keep their 3:2 proportions, with the nose facing
left. Cards and map markers contain the complete vehicle without cropping.
See [the artwork prompts and provenance](design/vehicle-icons.md).
See [vehicle identity](vehicle-identity.md) for the exact-model catalogue roadmap.

### Eats discovery artwork

The original `eats-hero.png` food illustration appears on web and native discovery.
It does not represent any specific seller's meal. Merchant cards and menus use
seller-uploaded photos when available; otherwise they show the established cuisine
symbols. Both platforms use the existing app font policy.

Image created with built-in image generation. Files:
`apps/web/public/assets/eats-hero.png` and
`apps/mobile/src/assets/eats-hero.png`.

Generation prompt:

> Create an original premium editorial food photograph for the hero banner of Taxi Ai Eats, a Nigerian food delivery marketplace. Wide landscape banner, approximately 3:2. Overhead composition on a warm buttery yellow table with soft daylight: beautiful authentic Nigerian jollof rice topped with grilled chicken in a simple cream bowl, golden fried plantain on a small plate, moi moi, fresh green salad, a folded plain linen napkin. Food occupies the RIGHT half and outer lower-right edge; LEFT half mostly clean buttery yellow negative space for separately rendered UI typography. Inviting, appetising, believable home-cooked portions, high-end natural food photography, warm colours, realistic textures, clean restrained styling. No people, hands, text, lettering, logos, watermarks, branding, restaurant storefronts, prices or packaging labels. This is general illustrative artwork, not a photograph of any actual seller's dish.
