/**
 * Offline map navigation anchors across all 36 Nigerian states and the FCT.
 * WGS84 coordinates locate city/district views; they are NOT administrative
 * boundaries, dispatch service areas, coverage promises, or customer locations.
 * Do not use these points to geocode legacy sample area IDs or assign trips to
 * cities. Map demand is located only from its own saved GPS coordinates.
 *
 * Natural Earth v5.1.2: Nigerian ADM0_A3=NGA populated-place point coordinates
 * and ADM1NAME labels. Opobo omitted because its state label is inconsistent.
 * Nassarawa -> Nasarawa; display spelling updates: Oshogbo -> Osogbo,
 * Ogbomosho -> Ogbomoso, Oturkpo -> Otukpo, Ife -> Ile-Ife.
 * GeoNames supplements the missing capital views and Wuse/Maitama. Coordinates
 * are unchanged from the 2026-09-25 Nigeria export. Wuse II is an OSM point,
 * node 31384766 version 6, retrieved 2026-09-25; no district polygon is supplied.
 * Sources retain their respective licenses in this collection. No network
 * requests or global datasets are needed at runtime.
 */
export const NIGERIA_MAP_SOURCES = Object.freeze([
  Object.freeze({
    id: 'natural-earth', name: 'Natural Earth', version: '5.1.2',
    url: 'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/',
    dataUrl: 'https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_10m_populated_places.geojson',
    license: 'Public domain', licenseUrl: 'https://www.naturalearthdata.com/about/terms-of-use/',
    sha256: '9b8e3de09048ef00dfc70357dbb9fa324493f214b5e0ae4daf1aa79a8d10116b',
  }),
  Object.freeze({
    id: 'geonames', name: 'GeoNames', retrievedOn: '2026-09-25',
    url: 'https://www.geonames.org/', dataUrl: 'https://download.geonames.org/export/dump/NG.zip',
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sha256: '3963149238e9d9e83f78b921c5f9aacb1fedaf62de8322b4b78527c4b6faf443',
  }),
  Object.freeze({
    id: 'openstreetmap', name: 'OpenStreetMap contributors', retrievedOn: '2026-09-25',
    url: 'https://www.openstreetmap.org/node/31384766/history/6',
    dataUrl: 'https://www.openstreetmap.org/api/0.6/node/31384766/6.json',
    license: 'ODbL 1.0', licenseUrl: 'https://www.openstreetmap.org/copyright',
  }),
]);

// The map- prefix deliberately keeps viewport IDs separate from sample areas.
const places = [
  { id: 'map-aba', name: 'Aba', stateId: 'abia', latitude: 5.100398, longitude: 7.34998, kind: 'city', sourceId: 'natural-earth:1159138759' },
  { id: 'map-umuahia', name: 'Umuahia', stateId: 'abia', latitude: 5.532003, longitude: 7.486002, kind: 'city', sourceId: 'natural-earth:1159116649' },
  { id: 'map-mubi', name: 'Mubi', stateId: 'adamawa', latitude: 10.270341, longitude: 13.270032, kind: 'city', sourceId: 'natural-earth:1159138937' },
  { id: 'map-numan', name: 'Numan', stateId: 'adamawa', latitude: 9.460442, longitude: 12.04003, kind: 'city', sourceId: 'natural-earth:1159138941' },
  { id: 'map-yola', name: 'Yola', stateId: 'adamawa', latitude: 9.209992, longitude: 12.480003, kind: 'city', sourceId: 'natural-earth:1159148221' },
  { id: 'map-uyo', name: 'Uyo', stateId: 'akwa-ibom', latitude: 5.036014, longitude: 7.916153, kind: 'city', sourceId: 'natural-earth:1159116677' },
  { id: 'map-awka', name: 'Awka', stateId: 'anambra', latitude: 6.210434, longitude: 7.069997, kind: 'city', sourceId: 'natural-earth:1159138843' },
  { id: 'map-onitsha', name: 'Onitsha', stateId: 'anambra', latitude: 6.140412, longitude: 6.779989, kind: 'city', sourceId: 'natural-earth:1159138849' },
  { id: 'map-azare', name: 'Azare', stateId: 'bauchi', latitude: 11.68041, longitude: 10.190013, kind: 'city', sourceId: 'natural-earth:1159138853' },
  { id: 'map-bauchi', name: 'Bauchi', stateId: 'bauchi', latitude: 10.310364, longitude: 9.840009, kind: 'city', sourceId: 'natural-earth:1159138857' },
  { id: 'map-yenagoa', name: 'Yenagoa', stateId: 'bayelsa', latitude: 4.92675, longitude: 6.26764, kind: 'city', sourceId: 'geonames:2318123' },
  { id: 'map-makurdi', name: 'Makurdi', stateId: 'benue', latitude: 7.729979, longitude: 8.530011, kind: 'city', sourceId: 'natural-earth:1159149695' },
  { id: 'map-otukpo', name: 'Otukpo', stateId: 'benue', latitude: 7.1904, longitude: 8.129984, kind: 'city', sourceId: 'natural-earth:1159138771' },
  { id: 'map-bama', name: 'Bama', stateId: 'borno', latitude: 11.520394, longitude: 13.690007, kind: 'city', sourceId: 'natural-earth:1159138753' },
  { id: 'map-biu', name: 'Biu', stateId: 'borno', latitude: 10.620423, longitude: 12.189995, kind: 'city', sourceId: 'natural-earth:1159138749' },
  { id: 'map-maiduguri', name: 'Maiduguri', stateId: 'borno', latitude: 11.851906, longitude: 13.158067, kind: 'city', sourceId: 'natural-earth:1159149691' },
  { id: 'map-calabar', name: 'Calabar', stateId: 'cross-river', latitude: 4.960407, longitude: 8.330024, kind: 'city', sourceId: 'natural-earth:1159138777' },
  { id: 'map-asaba', name: 'Asaba', stateId: 'delta', latitude: 6.19824, longitude: 6.73187, kind: 'city', sourceId: 'geonames:2349276' },
  { id: 'map-sapele', name: 'Sapele', stateId: 'delta', latitude: 5.890427, longitude: 5.680004, kind: 'city', sourceId: 'natural-earth:1159138871' },
  { id: 'map-warri', name: 'Warri', stateId: 'delta', latitude: 5.519959, longitude: 5.76, kind: 'city', sourceId: 'natural-earth:1159149703' },
  { id: 'map-abakaliki', name: 'Abakaliki', stateId: 'ebonyi', latitude: 6.32485, longitude: 8.11368, kind: 'city', sourceId: 'geonames:2353099' },
  { id: 'map-benin-city', name: 'Benin City', stateId: 'edo', latitude: 6.342423, longitude: 5.618062, kind: 'city', sourceId: 'natural-earth:1159149127' },
  { id: 'map-ado-ekiti', name: 'Ado Ekiti', stateId: 'ekiti', latitude: 7.630373, longitude: 5.219981, kind: 'city', sourceId: 'natural-earth:1159138825' },
  { id: 'map-enugu', name: 'Enugu', stateId: 'enugu', latitude: 6.450031, longitude: 7.499997, kind: 'city', sourceId: 'natural-earth:1159150771' },
  { id: 'map-nsukka', name: 'Nsukka', stateId: 'enugu', latitude: 6.867034, longitude: 7.383363, kind: 'city', sourceId: 'natural-earth:1159138875' },
  { id: 'map-abuja', name: 'Abuja', stateId: 'fct', latitude: 9.05462, longitude: 7.489505, kind: 'city', sourceId: 'natural-earth:1159150799' },
  { id: 'map-maitama', name: 'Maitama', stateId: 'fct', latitude: 9.09563, longitude: 7.4984, kind: 'district', sourceId: 'geonames:2331303' },
  { id: 'map-wuse', name: 'Wuse', stateId: 'fct', latitude: 9.07056, longitude: 7.4675, kind: 'district', sourceId: 'geonames:2318558' },
  { id: 'map-wuse-ii', name: 'Wuse II', stateId: 'fct', latitude: 9.0761981, longitude: 7.4759718, kind: 'district', sourceId: 'openstreetmap:node:31384766:v6' },
  { id: 'map-gombe', name: 'Gombe', stateId: 'gombe', latitude: 10.290443, longitude: 11.169954, kind: 'city', sourceId: 'natural-earth:1159138861' },
  { id: 'map-kumo', name: 'Kumo', stateId: 'gombe', latitude: 10.045703, longitude: 11.213052, kind: 'city', sourceId: 'natural-earth:1159138867' },
  { id: 'map-orlu', name: 'Orlu', stateId: 'imo', latitude: 5.783715, longitude: 7.033307, kind: 'city', sourceId: 'natural-earth:1159138767' },
  { id: 'map-owerri', name: 'Owerri', stateId: 'imo', latitude: 5.492997, longitude: 7.026004, kind: 'city', sourceId: 'natural-earth:1159116695' },
  { id: 'map-dutse', name: 'Dutse', stateId: 'jigawa', latitude: 11.799189, longitude: 9.350335, kind: 'city', sourceId: 'natural-earth:1159122333' },
  { id: 'map-kaduna', name: 'Kaduna', stateId: 'kaduna', latitude: 10.521961, longitude: 7.438054, kind: 'city', sourceId: 'natural-earth:1159149705' },
  { id: 'map-zaria', name: 'Zaria', stateId: 'kaduna', latitude: 11.081927, longitude: 7.708064, kind: 'city', sourceId: 'natural-earth:1159148217' },
  { id: 'map-kano', name: 'Kano', stateId: 'kano', latitude: 12.001923, longitude: 8.518092, kind: 'city', sourceId: 'natural-earth:1159151297' },
  { id: 'map-funtua', name: 'Funtua', stateId: 'katsina', latitude: 11.520394, longitude: 7.320008, kind: 'city', sourceId: 'natural-earth:1159138901' },
  { id: 'map-katsina', name: 'Katsina', stateId: 'katsina', latitude: 12.990407, longitude: 7.599991, kind: 'city', sourceId: 'natural-earth:1159138905' },
  { id: 'map-birnin-kebbi', name: 'Birnin Kebbi', stateId: 'kebbi', latitude: 12.450414, longitude: 4.19994, kind: 'city', sourceId: 'natural-earth:1159138927' },
  { id: 'map-koko', name: 'Koko', stateId: 'kebbi', latitude: 11.42319, longitude: 4.516975, kind: 'city', sourceId: 'natural-earth:1159138931' },
  { id: 'map-idah', name: 'Idah', stateId: 'kogi', latitude: 7.110404, longitude: 6.73994, kind: 'city', sourceId: 'natural-earth:1159138887' },
  { id: 'map-lokoja', name: 'Lokoja', stateId: 'kogi', latitude: 7.800388, longitude: 6.73994, kind: 'city', sourceId: 'natural-earth:1159138883' },
  { id: 'map-ilorin', name: 'Ilorin', stateId: 'kwara', latitude: 8.491956, longitude: 4.54805, kind: 'city', sourceId: 'natural-earth:1159148213' },
  { id: 'map-ikeja', name: 'Ikeja', stateId: 'lagos', latitude: 6.59651, longitude: 3.34205, kind: 'city', sourceId: 'geonames:2338313' },
  { id: 'map-lagos', name: 'Lagos', stateId: 'lagos', latitude: 6.445208, longitude: 3.389585, kind: 'city', sourceId: 'natural-earth:1159151591' },
  { id: 'map-keffi', name: 'Keffi', stateId: 'nasarawa', latitude: 8.849032, longitude: 7.873617, kind: 'city', sourceId: 'natural-earth:1159138895' },
  { id: 'map-lafia', name: 'Lafia', stateId: 'nasarawa', latitude: 8.490424, longitude: 8.520038, kind: 'city', sourceId: 'natural-earth:1159138891' },
  { id: 'map-bida', name: 'Bida', stateId: 'niger', latitude: 9.080413, longitude: 6.01001, kind: 'city', sourceId: 'natural-earth:1159138795' },
  { id: 'map-kontagora', name: 'Kontagora', stateId: 'niger', latitude: 10.400359, longitude: 5.46994, kind: 'city', sourceId: 'natural-earth:1159138789' },
  { id: 'map-minna', name: 'Minna', stateId: 'niger', latitude: 9.619993, longitude: 6.550029, kind: 'city', sourceId: 'natural-earth:1159148215' },
  { id: 'map-abeokuta', name: 'Abeokuta', stateId: 'ogun', latitude: 7.160427, longitude: 3.350017, kind: 'city', sourceId: 'natural-earth:1159138799' },
  { id: 'map-ijebu-ode', name: 'Ijebu Ode', stateId: 'ogun', latitude: 6.820448, longitude: 3.920008, kind: 'city', sourceId: 'natural-earth:1159138803' },
  { id: 'map-akure', name: 'Akure', stateId: 'ondo', latitude: 7.250396, longitude: 5.199982, kind: 'city', sourceId: 'natural-earth:1159138807' },
  { id: 'map-ikare', name: 'Ikare', stateId: 'ondo', latitude: 7.53043, longitude: 5.76, kind: 'city', sourceId: 'natural-earth:1159138813' },
  { id: 'map-ondo', name: 'Ondo', stateId: 'ondo', latitude: 7.090406, longitude: 4.840004, kind: 'city', sourceId: 'natural-earth:1159138821' },
  { id: 'map-owo', name: 'Owo', stateId: 'ondo', latitude: 7.200399, longitude: 5.589984, kind: 'city', sourceId: 'natural-earth:1159138817' },
  { id: 'map-ile-ife', name: 'Ile-Ife', stateId: 'osun', latitude: 7.480434, longitude: 4.560021, kind: 'city', sourceId: 'natural-earth:1159138831' },
  { id: 'map-iwo', name: 'Iwo', stateId: 'osun', latitude: 7.629959, longitude: 4.179993, kind: 'city', sourceId: 'natural-earth:1159129461' },
  { id: 'map-osogbo', name: 'Osogbo', stateId: 'osun', latitude: 7.770364, longitude: 4.560021, kind: 'city', sourceId: 'natural-earth:1159138835' },
  { id: 'map-ibadan', name: 'Ibadan', stateId: 'oyo', latitude: 7.381972, longitude: 3.928036, kind: 'city', sourceId: 'natural-earth:1159149697' },
  { id: 'map-iseyin', name: 'Iseyin', stateId: 'oyo', latitude: 7.970016, longitude: 3.590003, kind: 'city', sourceId: 'natural-earth:1159129465' },
  { id: 'map-ogbomoso', name: 'Ogbomoso', stateId: 'oyo', latitude: 8.131952, longitude: 4.238043, kind: 'city', sourceId: 'natural-earth:1159149701' },
  { id: 'map-oyo', name: 'Oyo', stateId: 'oyo', latitude: 7.850437, longitude: 3.929982, kind: 'city', sourceId: 'natural-earth:1159138839' },
  { id: 'map-jos', name: 'Jos', stateId: 'plateau', latitude: 9.929974, longitude: 8.890041, kind: 'city', sourceId: 'natural-earth:1159148219' },
  { id: 'map-port-harcourt', name: 'Port Harcourt', stateId: 'rivers', latitude: 4.811948, longitude: 7.008055, kind: 'city', sourceId: 'natural-earth:1159149693' },
  { id: 'map-sokoto', name: 'Sokoto', stateId: 'sokoto', latitude: 13.060016, longitude: 5.240031, kind: 'city', sourceId: 'natural-earth:1159150773' },
  { id: 'map-jalingo', name: 'Jalingo', stateId: 'taraba', latitude: 8.900373, longitude: 11.360019, kind: 'city', sourceId: 'natural-earth:1159138785' },
  { id: 'map-wukari', name: 'Wukari', stateId: 'taraba', latitude: 7.87041, longitude: 9.780013, kind: 'city', sourceId: 'natural-earth:1159138781' },
  { id: 'map-damaturu', name: 'Damaturu', stateId: 'yobe', latitude: 11.748996, longitude: 11.966005, kind: 'city', sourceId: 'natural-earth:1159122345' },
  { id: 'map-gashua', name: 'Gashua', stateId: 'yobe', latitude: 12.870492, longitude: 11.039987, kind: 'city', sourceId: 'natural-earth:1159138919' },
  { id: 'map-nguru', name: 'Nguru', stateId: 'yobe', latitude: 12.880388, longitude: 10.449998, kind: 'city', sourceId: 'natural-earth:1159138913' },
  { id: 'map-potiskum', name: 'Potiskum', stateId: 'yobe', latitude: 11.710382, longitude: 11.079985, kind: 'city', sourceId: 'natural-earth:1159138923' },
  { id: 'map-gusau', name: 'Gusau', stateId: 'zamfara', latitude: 12.170406, longitude: 6.659996, kind: 'city', sourceId: 'natural-earth:1159138909' },
];
export const NIGERIA_MAP_PLACES = Object.freeze(places.map((place) => Object.freeze(place)));

/** A convenient square viewport in degrees, never a city/district boundary. */
export function mapPlaceBounds(place) {
  if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)
    || place.latitude < -90 || place.latitude > 90 || place.longitude < -180 || place.longitude > 180
    || !['city', 'district'].includes(place.kind)) {
    throw new TypeError('Choose a valid map navigation place.');
  }
  const halfSpan = place.kind === 'district' ? 0.02 : 0.2;
  const rounded = (value) => Math.round(value * 1_000_000) / 1_000_000;
  return Object.freeze({
    west: rounded(place.longitude - halfSpan), south: rounded(place.latitude - halfSpan),
    east: rounded(place.longitude + halfSpan), north: rounded(place.latitude + halfSpan),
  });
}
