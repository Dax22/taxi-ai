/** All categories use the development booking workflow. Artwork is illustrative. */
export const VEHICLE_CATEGORIES = Object.freeze([
  { id: 'standard', name: 'Standard', purpose: 'Everyday car rides', statusLabel: 'Ride preview', ridePreview: true,
    assetPath: '/assets/vehicles/sedan-white.png', imageDescription: 'Realistic white sedan category image',
    description: 'Try the existing car ride preview. Review your route and agree a fare with the driver.' },
  { id: 'suv', name: 'SUV', purpose: 'More room for your ride', statusLabel: 'Ride preview', ridePreview: true,
    assetPath: '/assets/vehicles/category-suv.png', imageDescription: 'Realistic graphite grey SUV category image',
    description: 'Request an approved SUV and agree your fare. Check the assigned vehicle and plate before pickup.' },
  { id: 'van', name: 'Van', purpose: 'Larger parcel deliveries', statusLabel: 'Delivery preview', ridePreview: true,
    assetPath: '/assets/vehicles/category-van.png', imageDescription: 'Realistic white panel van category image',
    description: 'Book a parcel delivery with an approved van. Add the total weight and recipient details before requesting.' },
  { id: 'truck', name: 'Truck', purpose: 'Bulky cargo deliveries', statusLabel: 'Delivery preview', ridePreview: true,
    assetPath: '/assets/vehicles/category-truck.png', imageDescription: 'Realistic white cargo box truck category image',
    description: 'Book a cargo delivery with an approved truck. Describe the load and confirm it fits with the driver before collection.' },
  { id: 'motorcycle', name: 'Motorcycle', purpose: 'Food and small parcels', statusLabel: 'Delivery preview', ridePreview: true,
    assetPath: '/assets/vehicles/category-motorcycle.png', imageDescription: 'Realistic white street motorcycle category image',
    description: 'Send food or a small parcel with an approved motorcycle courier. Add recipient details and verify handover with a drop-off code.' },
].map(Object.freeze));

export function vehicleCategory(id) {
  return VEHICLE_CATEGORIES.find((category) => category.id === id) ?? null;
}
