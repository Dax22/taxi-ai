# Autonomous taxi concept artwork

The user requested a 3D version of their supplied autonomous shuttle, Taxi Ai
yellow accents and a man standing beside it using the app on an iPhone. The
section should match the homepage's light city illustration and avoid the old
image's stretched proportions.

## Implemented direction

- A compact upright white/graphite robotaxi with yellow lower panels, roof trim
  and sensor details, based on the user's vehicle reference.
- A full-body 3D passenger beside the vehicle, holding and tapping an iPhone
  with a simple yellow route interface.
- A near-white environment, soft shadows and sage trees matching the city hero.
- A light section with graphite copy and an amber coming-soon badge.
- A visible concept caption and the existing statement that autonomous rides
  are not available to book. No booking controls or launch date are introduced.

## Files and delivery

| Asset | Dimensions | Format | Size |
| --- | --- | --- | --- |
| `apps/web/public/assets/autonomous-concept.webp` | 1536 × 1024 | WebP | 55,758 bytes |
| `apps/web/public/assets/autonomous-concept-small.webp` | 960 × 640 | WebP | 30,754 bytes |

The image's `srcset` and `sizes` let the browser select a file for its viewport
and pixel density. Both exports preserve the full composition. The `img` has
accurate intrinsic dimensions, `width: 100%`, `height: auto`, a 3:2 aspect ratio
and `object-fit: contain`. It has no fixed rendered height or cover crop.

The figure has no default browser margins. The two-column section stacks below
800px so the image remains large enough to read on tablets and phones. The
caption sits below the artwork, rather than obscuring the passenger or wheels.
Descriptive alt text identifies both subjects.

Autonomous presentation rules now live in `apps/web/public/homepage.css`.
Replaced rules were removed from the shared stylesheet. The old
`autonomous.webp` and its static route were removed; both new variants use the
existing same-origin allowlist. No runtime dependency was added.

## Generation

Method: built-in image generation with two local reference images. The user's
uploaded autonomous vehicle supplied the shape and sensor arrangement.
`apps/web/public/assets/city-route-hero.webp` supplied only the 3D style,
lighting and palette. The generated scene was inspected, then exported with
ImageMagick at quality 84 for the full image and quality 82 for the 960px image.
Resizing preserved the aspect ratio and complete composition. No CLI
image-generation API or API key was used.

Final generation prompt:

> Use case: stylized-concept.
> Asset type: original 3D illustration for the autonomous taxis section of the Taxi Ai website.
> Input images: Image 1 is the vehicle design reference: preserve its compact upright robotaxi pod shape, tall cabin, sliding side doors, large dark glass, square front lights, round wheels and roof-corner lidar/camera sensor units. Image 2 is STYLE ONLY: match its refined miniature 3D materials, airy near-white environment, soft shadows, sage greenery and Taxi Ai amber-yellow accents. Do not reproduce its city map composition.
> Primary request: create a beautiful original 3D scene of this autonomous shuttle with yellow on it and an adult man standing beside it using the Taxi Ai app on an iPhone.
> Subject: one compact white and graphite autonomous pod based closely on image 1, with substantial tasteful Taxi Ai yellow (#F4B400) lower body panels, yellow roof trim and yellow sensor collars replacing the blue accents. A stylized adult Black man in a light ivory overshirt, dark trousers and clean white trainers stands next to the passenger side, clearly separate from the car, looking at an iPhone held naturally near chest height in one hand while tapping with the other. Full man visible from head to shoes. Human height is approximately the height of the vehicle cabin; normal adult proportions, not an oversized toy head. The iPhone is recognizable as a slim rounded black phone, screen angled partly toward the viewer with a tiny simple yellow/black route-map app interface; no readable fine text needed. He is standing safely, not driving.
> Scene/backdrop: softly lit near-white (#f8f9f7) ground and seamless background, subtle white curb/road platform, only two or three quiet sage sculptural trees in the far background. Open uncluttered space.
> Style/medium: premium friendly 3D clay/product render, rounded precision geometry, matte white and amber materials, subtle graphite glass reflections and believable ambient occlusion. Same bright calm miniature-world aesthetic as image 2.
> Composition/framing: landscape 3:2 image for a website content panel; gently elevated three-quarter front view, vehicle slightly to the left and man beside its right side. Both subjects fully in frame with a small clear gap, all wheels, roof sensors and man's feet visible. Natural short wheelbase and upright vehicle proportions, no width distortion or stretched limousine body. Vehicle and man together fill roughly 85% of frame, with soft breathing room at every edge. Grounding shadows, not floating. No top-down map view.
> Lighting/mood: diffuse bright studio daylight, soft realistic shadows, calm and welcoming.
> Text: small clean "Taxi Ai" lettering on a yellow body panel is allowed; no other text.
> Avoid: photography, dark background, blue vehicle accents, oversized cartoon head, deformed hands, extra people, extra phones, extra cars, oval stretched tires, crop of wheels or feet, huge floating phone, UI cards, website screenshot, buttons, watermark, third-party vehicle logos. This is a future concept illustration, not a depiction of a currently available robotaxi service.

## Verification

The exported illustration was visually inspected for yellow accents, the
passenger and phone, complete subjects and natural vehicle proportions.
The existing static-serving checks cover both new image routes and MIME types.
`npm run verify` passed all 216 tests and 147 module checks. HTML review found
46 unique IDs, 29 valid references and 8 local assets. There are no changes to
booking, fare, payment, safety or database rules.

Browser layout and interaction review at 390, 768 and 1440px remains a manual
acceptance item because the available cloud browser previously blocked local
preview access. Source, image and HTTP checks do not replace browser/device QA.
