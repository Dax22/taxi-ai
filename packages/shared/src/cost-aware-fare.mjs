/**
 * Transparent, read-only Nigerian fare recommendation. Requires a vetted pricing
 * policy and fresh, verified road/fuel observations. Does not accept payment or
 * modify a booked fare. Both rider and driver must explicitly agree in-app.
 * All amounts use integer kobo; no implicit surge or invented fuel prices.
 */
export const FARE_ADVISORY_VERSION='ng-cost-aware-advisory-v1';
export const COMMISSION_BPS=1000;
export const MAX_ROUTE_AGE_MS=300_000;
export const MAX_FUEL_AGE_MS=7*24*60*60*1000;
const MAX_AMOUNT=500_000_000,MAX_ROUTE=250_000;
const validInt=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const ceilMulDiv=(a,b,d)=>Number((BigInt(a)*BigInt(b)+BigInt(d)-1n)/BigInt(d));
const unavailable=reason=>Object.freeze({status:'unavailable',reason,
 version:FARE_ADVISORY_VERSION,automaticFareChange:false,requiresTwoPartyAcceptance:true,
 notice:'No automatic fare can be generated from incomplete or stale operating-cost evidence.'});
function validatePolicy(p){
 if(!p||p.commissionBps!==COMMISSION_BPS
  ||!validInt(p.baseFareKobo,0,MAX_AMOUNT)
  ||!validInt(p.perKmKobo,0,MAX_AMOUNT)
  ||!validInt(p.perMinuteKobo,0,MAX_AMOUNT)
  ||!validInt(p.minimumFareKobo,100,MAX_AMOUNT)
  ||!validInt(p.maximumFareKobo,p.minimumFareKobo,MAX_AMOUNT)
  ||!validInt(p.maintenancePerKmKobo,0,MAX_AMOUNT)
  ||!validInt(p.minimumDriverPayKobo,0,MAX_AMOUNT)
  ||!validInt(p.fuelMillilitresPer100Km,1000,50000))
   throw new TypeError('A complete, vetted fare policy with 10% commission is required.');
}
export function computeFareAdvisory({route,fuel,policy,now,vehicleCategory='standard'}={}){
 validatePolicy(policy);
 if(!validInt(now,0,Number.MAX_SAFE_INTEGER-300_000))throw new TypeError('A valid server clock is required.');
 if(typeof vehicleCategory!=='string'||!/^[a-z]{3,20}$/.test(vehicleCategory))throw new TypeError('Invalid vehicle category.');
 if(!route||route.source!=='verified_road'||!validInt(route.distanceMeters,500,MAX_ROUTE)
  ||!validInt(route.durationSeconds,60,108000)||!validInt(route.estimatedAt,0,now)
  ||now-route.estimatedAt>MAX_ROUTE_AGE_MS)return unavailable('verified_route_missing_or_stale');
 if(!fuel||fuel.source!=='approved_reference'||!validInt(fuel.priceKoboPerLitre,100,1_000_000)
  ||!validInt(fuel.observedAt,0,now)||now-fuel.observedAt>MAX_FUEL_AGE_MS)
  return unavailable('verified_fuel_price_missing_or_stale');

 const distanceChargeKobo=ceilMulDiv(route.distanceMeters,policy.perKmKobo,1000);
 const timeChargeKobo=ceilMulDiv(route.durationSeconds,policy.perMinuteKobo,60);
 const maintenanceCostKobo=ceilMulDiv(route.distanceMeters,policy.maintenancePerKmKobo,1000);
 // 100 km = 100,000 m and one litre = 1,000 ml.
 const fuelCostKobo=Number((BigInt(route.distanceMeters)*BigInt(policy.fuelMillilitresPer100Km)
  *BigInt(fuel.priceKoboPerLitre)+99_999_999n)/100_000_000n);
 const costFloorKobo=fuelCostKobo+maintenanceCostKobo+policy.minimumDriverPayKobo;
 if(!Number.isSafeInteger(costFloorKobo))return unavailable('operating_cost_overflow');
 const floorForDriverKobo=ceilMulDiv(costFloorKobo,10_000,10_000-COMMISSION_BPS);
 const gross=Math.max(policy.baseFareKobo+distanceChargeKobo+timeChargeKobo,
  policy.minimumFareKobo,floorForDriverKobo);
 const fareKobo=ceilMulDiv(gross,1,5000)*5000;
 if(!validInt(fareKobo,100,policy.maximumFareKobo))
  return unavailable('cost_floor_exceeds_approved_fare_limit');
 const commissionKobo=ceilMulDiv(fareKobo,COMMISSION_BPS,10_000);
 const driverNetBeforeOperatingCostsKobo=fareKobo-commissionKobo;
 return Object.freeze({
  status:'advisory',version:FARE_ADVISORY_VERSION,vehicleCategory,
  customerFareKobo:fareKobo,commissionBps:COMMISSION_BPS,commissionKobo,
  driverNetBeforeOperatingCostsKobo,
  estimatedFuelCostKobo:fuelCostKobo,estimatedMaintenanceCostKobo:maintenanceCostKobo,
  estimatedNetAfterOperatingCostsKobo:driverNetBeforeOperatingCostsKobo-fuelCostKobo-maintenanceCostKobo,
  components:Object.freeze({baseFareKobo:policy.baseFareKobo,distanceChargeKobo,timeChargeKobo,
   floorForDriverKobo}),
  inputProvenance:Object.freeze({routeSource:'verified_road',routeEstimatedAt:route.estimatedAt,
   fuelSource:'approved_reference',fuelObservedAt:fuel.observedAt}),
  automaticFareChange:false,requiresTwoPartyAcceptance:true,
  notice:'A pricing suggestion only. Rider and assigned driver must both accept the fare inside Taxi Ai.',
 });
}
