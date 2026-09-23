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

Taxi Ai uses **Manrope** across iOS, Android, web and admin. Native builds bundle
Regular, Medium, Semibold, Bold and ExtraBold faces; `src/ui/typography.tsx` maps
each text weight to its installed face, including form and navigation labels.
Web styles import `typography.css` and self-host the variable Latin and Latin
Extended files, including characters used in Nigerian names. No live font service
is required. Sizes and weights retain their heading/body hierarchy and native text scaling.

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
