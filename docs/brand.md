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

Branding changes do not enable live bookings, food orders, courier dispatch,
communications, payments or autonomous rides.
