# Rounded vehicle icons

Created on 2026-09-20 with built-in ImageGen in generate/edit mode. The user supplied
a white rounded 3D car on a white background as the style reference. The resulting
car is a generic illustration; it does not establish the driver's make, model,
model year, trim or actual paint code. Plate text is rendered by the interface from
the saved record and never generated into the artwork.

## Project assets

- Web: `apps/web/public/assets/vehicles/sedan-{colour}.png`.
- Native: `apps/mobile/src/assets/vehicles/sedan-{colour}.png`.
- Colours: white, silver, grey, black, blue, red, green, yellow, gold and brown.
- Neutral uses the same white image, with an explicit model/colour mismatch note.
- Every delivered file is a 640×640 transparent palette PNG, below 75 kB. Export
  resized the generated square uniformly and compressed it; no synthetic plate,
  colour filter or nonuniform scaling is applied. Native and web copies match.
- Cards and the map crop the empty top/bottom margins at render time while retaining
  the complete car silhouette. Standalone generated/exported icons were inspected.
  Browser layout and physical-device acceptance still need review.

## Exact prompts

Base generation, with the user reference attached:

> Create a single production UI vehicle icon for Taxi Ai, using the attached image as the visual style and composition reference. Stylized 3D clay render of a generic modern compact four-door sedan, rounded smooth white body, dark charcoal windows, black tyres, simple white circular wheel covers, black mirrors, subtle white headlights. Elevated front three-quarter view facing toward the lower right; see front, left side and roof. Entire car visible with generous margins, naturally proportioned, centered on a square 1024x1024 canvas. Car fills about 80% of canvas width. Soft ambient studio illumination and a small soft contact shadow. Clean very pale warm-white background (#F7F7F4). No words, numbers, plate lettering, badges, logos, people, UI or watermarks. Match the soft minimal premium 3D appearance of the reference, not a flat vector or a sharp angular polygon illustration. This is a generic illustrative car, not an identifiable make or model. Output only one white car asset.

Transparency edit, with the generated white car attached:

> Edit the attached white rounded 3D car icon. Preserve exactly the car shape, white paint, charcoal glass, white hubcaps, all wheels, scale, front three-quarter camera angle, placement and square canvas. Remove the white background and output a real transparent alpha background, preserving a soft semi-transparent contact shadow beneath the tyres. Do not change the vehicle or add details. Output a single production app icon PNG, no words, logos, numbers or UI. The transparent icon must sit cleanly on a map or pale interface.

Each paint variant used the transparent white source as its reference, in a separate
built-in image edit. All variants retain the same camera and generic body shape.

### Silver

> Make ONE colour variant of this exact attached generic rounded 3D car icon for an app. Change ONLY the white body paint (roof, hood, doors, fenders and bumpers) to light metallic silver. Preserve the exact same shape, camera, scale, position, charcoal black glass, black tyres/mirrors, white wheel covers and white headlights. Do not colour the white wheel covers. Keep the square canvas and real transparent alpha background with a soft semi-transparent contact shadow. Entire car visible, front three-quarter view facing lower right. No words, numbers, plate text, logos, other objects or UI. Return one isolated silver car PNG matching the reference geometry.

### Grey

> Make ONE colour variant of this exact attached generic rounded 3D car icon for an app. Change ONLY the white body paint (roof, hood, doors, fenders and bumpers) to medium graphite grey. Preserve the exact same shape, camera, scale, position, charcoal black glass, black tyres/mirrors, white wheel covers and white headlights. Do not colour the white wheel covers. Keep the square canvas and real transparent alpha background with a soft semi-transparent contact shadow. Entire car visible, front three-quarter view facing lower right. No words, numbers, plate text, logos, other objects or UI. Return one isolated grey car PNG matching the reference geometry.

### Black

> Make ONE colour variant of this exact attached generic rounded 3D car icon for an app. Change ONLY the white body paint (roof, hood, doors, fenders and bumpers) to deep charcoal black. Preserve the exact same shape, camera, scale, position, charcoal black glass, black tyres/mirrors, white wheel covers and white headlights. Do not colour the white wheel covers. Keep the square canvas and real transparent alpha background with a soft semi-transparent contact shadow. Entire car visible, front three-quarter view facing lower right. No words, numbers, plate text, logos, other objects or UI. Return one isolated black car PNG matching the reference geometry.

### Blue

> Make ONE colour variant of this exact attached generic rounded 3D car icon for an app. Change ONLY the white body paint (roof, hood, doors, fenders and bumpers) to medium vivid blue. Preserve the exact same shape, camera, scale, position, charcoal black glass, black tyres/mirrors, white wheel covers and white headlights. Do not colour the white wheel covers. Keep the square canvas and real transparent alpha background with a soft semi-transparent contact shadow. Entire car visible, front three-quarter view facing lower right. No words, numbers, plate text, logos, other objects or UI. Return one isolated blue car PNG matching the reference geometry.

### Red

> Make ONE colour variant of this exact attached generic rounded 3D car icon for an app. Change ONLY the white body paint (roof, hood, doors, fenders and bumpers) to rich red. Preserve the exact same shape, camera, scale, position, charcoal black glass, black tyres/mirrors, white wheel covers and white headlights. Do not colour the white wheel covers. Keep the square canvas and real transparent alpha background with a soft semi-transparent contact shadow. Entire car visible, front three-quarter view facing lower right. No words, numbers, plate text, logos, other objects or UI. Return one isolated red car PNG matching the reference geometry.

### Green

> Make ONE colour variant of this exact attached generic rounded 3D car icon for an app. Change ONLY the white body paint (roof, hood, doors, fenders and bumpers) to deep green. Preserve the exact same shape, camera, scale, position, charcoal black glass, black tyres/mirrors, white wheel covers and white headlights. Do not colour the white wheel covers. Keep the square canvas and real transparent alpha background with a soft semi-transparent contact shadow. Entire car visible, front three-quarter view facing lower right. No words, numbers, plate text, logos, other objects or UI. Return one isolated green car PNG matching the reference geometry.

### Yellow

> Make ONE colour variant of this exact attached generic rounded 3D car icon for an app. Change ONLY the white body paint (roof, hood, doors, fenders and bumpers) to Taxi Ai golden yellow (#F4B400). Preserve the exact same shape, camera, scale, position, charcoal black glass, black tyres/mirrors, white wheel covers and white headlights. Do not colour the white wheel covers. Keep the square canvas and real transparent alpha background with a soft semi-transparent contact shadow. Entire car visible, front three-quarter view facing lower right. No words, numbers, plate text, logos, other objects or UI. Return one isolated yellow car PNG matching the reference geometry.

### Gold

> Make ONE colour variant of this exact attached generic rounded 3D car icon for an app. Change ONLY the white body paint (roof, hood, doors, fenders and bumpers) to muted metallic champagne gold. Preserve the exact same shape, camera, scale, position, charcoal black glass, black tyres/mirrors, white wheel covers and white headlights. Do not colour the white wheel covers. Keep the square canvas and real transparent alpha background with a soft semi-transparent contact shadow. Entire car visible, front three-quarter view facing lower right. No words, numbers, plate text, logos, other objects or UI. Return one isolated gold car PNG matching the reference geometry.

### Brown

> Make ONE colour variant of this exact attached generic rounded 3D car icon for an app. Change ONLY the white body paint (roof, hood, doors, fenders and bumpers) to medium chocolate brown. Preserve the exact same shape, camera, scale, position, charcoal black glass, black tyres/mirrors, white wheel covers and white headlights. Do not colour the white wheel covers. Keep the square canvas and real transparent alpha background with a soft semi-transparent contact shadow. Entire car visible, front three-quarter view facing lower right. No words, numbers, plate text, logos, other objects or UI. Return one isolated brown car PNG matching the reference geometry.


Regeneration is not a substitute for reviewing the output. Inspect transparency,
paint, retained white wheel covers, silhouette and small-size readability before
replacing both platform copies. The [vehicle identity roadmap](../vehicle-identity.md)
explains how future licensed exact-model assets will be resolved.

