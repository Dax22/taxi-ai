/** Category browsing only. These illustrations do not classify a registered vehicle. */
export const VEHICLE_CATEGORIES = Object.freeze([
  { id: 'standard', name: 'Standard', purpose: 'Everyday car rides', statusLabel: 'Ride preview', ridePreview: true,
    assetPath: '/assets/vehicles/sedan-white.png', imageDescription: 'White rounded car illustration',
    description: 'Try the existing car ride preview. Review your route and agree a fare with the driver.' },
  { id: 'suv', name: 'SUV', purpose: 'More room for your ride', statusLabel: 'Coming soon', ridePreview: false,
    assetPath: '/assets/vehicles/category-suv.png', imageDescription: 'Silver Cybertruck category illustration',
    description: 'SUV bookings are coming soon. The Cybertruck is category artwork; it does not guarantee the vehicle you will receive.' },
  { id: 'van', name: 'Van', purpose: 'Larger parcel deliveries', statusLabel: 'Coming soon', ridePreview: false,
    assetPath: '/assets/vehicles/category-van.png', imageDescription: 'White panel van illustration',
    description: 'Van delivery bookings are coming soon, for parcels that need more room.' },
  { id: 'truck', name: 'Truck', purpose: 'Bulky cargo deliveries', statusLabel: 'Coming soon', ridePreview: false,
    assetPath: '/assets/vehicles/category-truck.png', imageDescription: 'White cargo box truck illustration',
    description: 'Truck delivery bookings are coming soon, for larger loads and bulky items.' },
  { id: 'motorcycle', name: 'Motorcycle', purpose: 'Food and small parcels', statusLabel: 'Coming soon', ridePreview: false,
    assetPath: '/assets/vehicles/category-motorcycle.png', imageDescription: 'White street motorcycle illustration',
    description: 'Motorcycle deliveries are coming soon for food and small parcels. Passenger motorcycle rides are not offered.' },
].map(Object.freeze));

export function vehicleCategory(id) {
  return VEHICLE_CATEGORIES.find((category) => category.id === id) ?? null;
}
