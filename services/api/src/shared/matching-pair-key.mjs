/** Collision-free internal key for a requested ride/driver pair. */
export const matchingPairKey = (rideId, driverId) => JSON.stringify([rideId, driverId]);
