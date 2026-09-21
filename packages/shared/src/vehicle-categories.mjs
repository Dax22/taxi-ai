/** All categories use the development booking workflow. Artwork is illustrative. */
export const VEHICLE_CATEGORIES = Object.freeze([
  { id: 'standard', name: 'Standard', purpose: 'Everyday car rides', statusLabel: 'Ride preview', ridePreview: true,
    assetPath: '/assets/vehicles/sedan-white.png', imageDescription: 'White rounded car illustration',
    description: 'Try the existing car ride preview. Review your route and agree a fare with the driver.' },
  { id: 'suv', name: 'SUV', purpose: 'More room for your ride', statusLabel: 'Ride preview', ridePreview: true,
    assetPath: '/assets/vehicles/category-suv.png', imageDescription: 'Silver Cybertruck category illustration',
    description: 'Request an approved SUV and agree your fare. The Cybertruck is category artwork; check the assigned vehicle and plate.' },
  { id: 'van', name: 'Van', purpose: 'Larger parcel deliveries', statusLabel: 'Delivery preview', ridePreview: true,
    assetPath: '/assets/vehicles/category-van.png', imageDescription: 'White panel van illustration',
    description: 'Book a parcel delivery with an approved van. Add the total weight and recipient details before requesting.' },
  { id: 'truck', name: 'Truck', purpose: 'Bulky cargo deliveries', statusLabel: 'Delivery preview', ridePreview: true,
    assetPath: '/assets/vehicles/category-truck.png', imageDescription: 'White cargo box truck illustration',
    description: 'Book a cargo delivery with an approved truck. Describe the load and confirm it fits with the driver before collection.' },
  { id: 'motorcycle', name: 'Motorcycle', purpose: 'Food and small parcels', statusLabel: 'Delivery preview', ridePreview: true,
    assetPath: '/assets/vehicles/category-motorcycle.png', imageDescription: 'White street motorcycle illustration',
    description: 'Send food or a small parcel with an approved motorcycle courier. Add recipient details and verify handover with a drop-off code.' },
].map(Object.freeze));

export function vehicleCategory(id) {
  return VEHICLE_CATEGORIES.find((category) => category.id === id) ?? null;
}
