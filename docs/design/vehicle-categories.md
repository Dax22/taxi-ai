# Vehicle category artwork

Created with built-in ImageGen on 2026-09-21. SUV edits the user-supplied Cybertruck reference; the other three use the existing white sedan as the style reference. All four outputs were visually inspected. Uniformly resized to 640×640 and compressed as palette PNGs, preserving generated alpha, shadows and proportions. No drawing, shape, colour or perspective edits were applied during export.

The matching web/native copies are `apps/web/public/assets/vehicles/category-{suv,van,truck,motorcycle}.png` and `apps/mobile/src/assets/vehicles/category-{suv,van,truck,motorcycle}.png`. Standard continues to use `sedan-white.png`. Each new image is under 110 kB. The UI renders whole images with contain sizing.

These are category illustrations, separate from the existing registered-vehicle colour cards and actual driver identity. They do not establish availability, capacity or a specific make/model match.

## Exact prompts

### suv

Use case: background-extraction. Edit the attached user-supplied silver Cybertruck image into one production vehicle-category icon for the Taxi Ai app. Preserve the exact silver angular Cybertruck, its body design, open cargo bed, charcoal tyres, dark windows, red rear light strip and rear three-quarter camera view. Remove only the grey studio floor/background. Reframe the entire vehicle centered in a square 1024 by 1024 canvas with generous empty margins; the truck fills about 82 percent of canvas width. Output real transparent alpha behind and around the truck with a subtle semi-transparent contact shadow. Keep the complete vehicle silhouette and all visible wheels. Do not add text, category labels, logos, people, roads, other vehicles or interface elements. Return a single isolated transparent PNG.

### van

Use case: stylized-concept. Asset type: a single vehicle-category icon for Taxi Ai web and mobile. The attached existing car icon is a style and camera reference only. Create a modern white panel delivery van with a tall roof, short hood, sliding side door and no rear passenger side windows. Match the reference's premium minimal soft 3D rendering, smooth white body surfaces, dark charcoal glass where applicable, black tyres and restrained realistic detail. Elevated front three-quarter camera facing toward the lower right, show the front, left side and top. Center the entire vehicle on a square 1024 by 1024 canvas, filling about 82 percent of the canvas width with generous margins. Genuine transparent alpha background and a small soft semi-transparent contact shadow. Soft studio illumination. Clear recognizable silhouette at small size. One vehicle only. No letters, numbers, plate lettering, badges, logos, people, UI, watermarks, ground plane or scenery.

### truck

Use case: stylized-concept. Asset type: a single vehicle-category icon for Taxi Ai web and mobile. The attached existing car icon is a style and camera reference only. Create a small white commercial box truck with a clearly separate forward cab and tall rectangular cargo box, visibly larger cargo volume than a panel van, two axles. Match the reference's premium minimal soft 3D rendering, smooth white body surfaces, dark charcoal glass where applicable, black tyres and restrained realistic detail. Elevated front three-quarter camera facing toward the lower right, show the front, left side and top. Center the entire vehicle on a square 1024 by 1024 canvas, filling about 82 percent of the canvas width with generous margins. Genuine transparent alpha background and a small soft semi-transparent contact shadow. Soft studio illumination. Clear recognizable silhouette at small size. One vehicle only. No letters, numbers, plate lettering, badges, logos, people, UI, watermarks, ground plane or scenery.

### motorcycle

Use case: stylized-concept. Asset type: a single vehicle-category icon for Taxi Ai web and mobile. The attached existing car icon is a style and camera reference only. Create one white modern standard street motorcycle with two visible black tyres, silver wheel hubs, a black saddle, mirrors and handlebars; no rider, no delivery box. Match the reference's premium minimal soft 3D rendering, smooth white body surfaces, dark charcoal glass where applicable, black tyres and restrained realistic detail. Elevated front three-quarter camera facing toward the lower right, show the front, left side and top. Center the entire vehicle on a square 1024 by 1024 canvas, filling about 82 percent of the canvas width with generous margins. Genuine transparent alpha background and a small soft semi-transparent contact shadow. Soft studio illumination. Clear recognizable silhouette at small size. One vehicle only. No letters, numbers, plate lettering, badges, logos, people, UI, watermarks, ground plane or scenery.
