# Realistic vehicle artwork

Updated on 2026-09-21 with the built-in ImageGen tool. The user supplied a
photographic grey SUV cutout as the style and camera reference. Five separate
category generations and nine sedan paint edits replace the previous rounded
car illustrations and Cybertruck category artwork.

These are generated example images, not photographs of approved drivers' vehicles.
They do not establish make, model, year, capacity, availability or exact paint
codes. Every vehicle card retains its illustration disclaimer and the assigned
plate as selectable text. Private driver evidence is never used as public artwork.

## App assets

- Web: `apps/web/public/assets/vehicles/`.
- Native: `apps/mobile/src/assets/vehicles/`.
- Standard: `sedan-white.png`; SUV: `category-suv.png`; van: `category-van.png`;
  truck: `category-truck.png`; motorcycle: `category-motorcycle.png`.
- Sedan colours: `sedan-{white,silver,grey,black,blue,red,green,yellow,gold,brown}.png`.
- Web `sedan-neutral.png` is identical to white; native neutral resolves to white.
  Unknown/custom/two-tone colours keep the existing explicit mismatch note.
- Originals were generated as 1536×1024 RGBA PNGs. App exports are uniformly
  downscaled to 768×512, with lossless PNG compression and full RGBA colour;
  no cropping, recolouring or manual background removal is used in export.
  The generated alpha is retained, including soft edges and contact shadows.
- The fourteen unique exports total about 4.57 MB. Sedan assets are below
  350 kB each; category assets are below 450 kB each. Web and native copies match
  byte for byte. The more detailed images increase asset size over the old icons.
- All vehicles face left in a front three-quarter view. Cards use `contain`
  at 3:2, and map markers use SVG `meet`, so roofs and wheels remain visible.

## Exact generation prompts

Mode: built-in ImageGen; five separate `product-mockup` generations with the
user's grey SUV as a style/camera reference. Each call used the common prompt
below followed by the corresponding subject paragraph.

```text
Use case: product-mockup. Asset type: one production vehicle image for the Taxi AI ride and delivery app. Image 1 is a STYLE AND CAMERA REFERENCE ONLY: match its realistic dealership catalog photography, front three-quarter viewpoint with the vehicle's nose pointing to the LEFT and a visible long side receding to the right, natural proportions, glossy paint, dark glass, detailed alloy wheels, crisp soft studio highlights. Create ONE vehicle only, isolated on a genuinely transparent alpha background, no black/white fill and no checkerboard baked in. Full vehicle and every wheel visible, centered on a landscape 1536x1024 canvas, with about 7% clear margin left and right and 12% above and below; vehicle fills about 86% width. Camera around headlight height, only a little of the roof visible, matching the reference. Subtle semi-transparent tyre contact shadow only. Photorealistic, premium automotive catalog cutout, NOT toy, cartoon, clay, low-poly or illustration. No badge, brand mark, readable plate, text, watermark, people, road, scenery, pedestal or border. Wheels, mirrors and accessories retain realistic neutral metal/black. Deliver an actual transparent PNG with alpha.
```

### sedan-white

```text
Subject: a modern generic mid-size FOUR-DOOR SEDAN, low roof, distinct trunk, premium glossy pearl WHITE paint. Recognizably a passenger sedan, not a crossover. Black grille, realistic LED headlamps, silver alloy wheels. Do not duplicate the reference SUV body.
```

### category-suv

```text
Subject: a modern generic mid-size FIVE-DOOR SUV, premium dark GRAPHITE GREY metallic paint, higher roof and ground clearance, clearly an enclosed family SUV. Similar proportions to the reference SUV, with an original unbranded grille/body design; NOT a pickup and NOT a Cybertruck.
```

### category-van

```text
Subject: a realistic modern WHITE commercial PANEL DELIVERY VAN with high roof, short hood, one sliding side door and a windowless rear cargo body. A light commercial van, not a passenger minibus and not a box truck. Dark windows only at the front cab, black lower trim, realistic silver wheels.
```

### category-truck

```text
Subject: a realistic medium-duty WHITE commercial BOX TRUCK, a separate short forward cab and tall rectangular enclosed white cargo box on a two-axle chassis. Clearly recognizable as a cargo truck, not a panel van, pickup or semi-trailer. Black chassis/tyres, silver rims, detailed unbranded cab.
```

### category-motorcycle

```text
Subject: one realistic modern commuter STREET MOTORCYCLE for a courier, glossy WHITE fuel tank and front fairing, black saddle and frame, realistic silver/black engine, two black tyres on alloy wheels, mirrors, handlebars and headlamp. No rider, no cargo box. A motorbike, not a bicycle or toy. Both wheels clearly visible and the bike is upright with a discreet side stand. Match the reference's photorealistic product-cutout lighting and front three-quarter camera direction.
```

## Exact sedan edit prompts

Mode: built-in ImageGen; nine separate `precise-object-edit` calls, each with
the generated white sedan as the edit target. Replace `COLOR` in the following
template with the exact value from the table; all other text is unchanged.

```text
Use case: precise-object-edit. The attached image is the EDIT TARGET. Create one production paint-color variant of this exact realistic sedan. Change ONLY the exterior painted body panels (hood, roof, doors, fenders, bumpers, mirror painted caps and trunk) to COLOR. Preserve the identical sedan body design, camera view, nose facing left, framing, landscape 1536x1024 canvas, scale, every visible wheel, silver alloy rims, dark windows, black grille/trim/tyres, headlamps, reflections and light direction. Retain photorealistic catalog quality. Preserve the real transparent alpha background and a subtle tyre contact shadow. Do not add a background, floor, text, license plate letters, logos, people or other objects. Return exactly one isolated vehicle PNG with transparency.
```

| Filename | COLOR |
| --- | --- |
| `sedan-silver.png` | light metallic silver |
| `sedan-grey.png` | medium graphite grey |
| `sedan-black.png` | deep glossy black |
| `sedan-blue.png` | rich metallic blue |
| `sedan-red.png` | deep glossy red |
| `sedan-green.png` | dark metallic emerald green |
| `sedan-yellow.png` | Taxi AI golden yellow, approximately #F4B400 |
| `sedan-gold.png` | metallic champagne gold |
| `sedan-brown.png` | metallic chocolate brown |

## Verification and remaining acceptance

Generated subjects, camera direction, paint variants and complete silhouettes
were visually inspected. Export checks verify RGBA transparency, dimensions,
file budgets and matching web/native bytes. Existing automated checks cover
vehicle identity, fallback colours, allowlisted images and app integration.

Browser rendering and signed iOS/Android devices still require visual acceptance.
Check category grids, booking/Work cards, the web map marker, narrow screens and
large text. A successful native bundle export is not a real-phone layout test.
