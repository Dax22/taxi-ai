# Platform maps in the native app

Android renders Google Maps; iOS renders Apple Maps through MapKit. The shared
`src/maps/` view uses the installed Expo SDK's recommended `react-native-maps`
version, pinned with the native lockfile. iOS does not request the Google provider
or add a Google Maps iOS key/library through its config plugin.

## Where maps appear

- Booking's route preview offers **Show Google Maps** or **Show Apple Maps**, with
  route points and the server's route geometry. Direct-distance deliveries use a
  dashed line and retain their straight-line explanation. The decorative route
  outline remains available when the map is hidden or Android is unconfigured.
- Journey and Safety offer the same map for the driver's explicitly shared GPS
  point. Stale markers are grey and labelled last known; time and accuracy remain
  visible outside the map. **Show latest position on map** recentres the view.
- Sample journeys without coordinates do not fabricate map locations.

Opening a map is explicit because its provider receives the viewed area. It
does not start GPS, enable tracking, accept a fare or change the selected route.
Maps are hidden/unmounted on screen blur, backgrounding and account teardown.
SDK location/traffic layers and the Android navigation toolbar are disabled.
Native map attribution remains visible. Textual trip details remain available
if map tiles fail or the device is offline. A native map-ready event does not
prove tiles or a configured API key work.

## Android setup

1. In the project's Google Cloud account, enable **Maps SDK for Android** and
   configure the billing account required by Google Maps Platform.
2. Create a client SDK key restricted to **Android apps**, the actual package
   name (currently `com.taxiai.app`), and the signing certificate's SHA-1. Add the
   preview signing certificate for internal builds and the Play app-signing
   certificate when distributing through Play. Restrict the API to Maps SDK for
   Android.
3. Set `GOOGLE_MAPS_ANDROID_API_KEY` in the EAS **preview** environment. Do not
   commit its value. The config plugin writes it into the Android manifest;
   client SDK keys can be extracted from an app, so restrictions are necessary.
   The JavaScript runtime only uses a configuration-present flag.
4. Rebuild and install the signed Android app. An environment change alone does
   not update an installed manifest. Inspect real tiles on the signed build;
   success in Expo Go does not validate your app's key or signing restriction.

The Firebase `GOOGLE_SERVICES_JSON` setting is separate and does not supply the
Maps key. Missing Android configuration uses the route outline/text fallback
without mounting an unconfigured Google Map. Invalid-key and billing errors can
still cause blank tiles; verify those on the physical test phone.

iOS MapKit needs no Google Maps key. Rebuild the iOS app after installing this
native dependency. Existing Apple signing requirements still apply.

## Map display versus backend routing

This change supplies the native street map. Address search still uses the
configured backend search service, and road geometry/distance/time still come
from the configured routing service (currently Photon/OSRM with OpenStreetMap
data). The existing backend owns fare suggestions and agreed fares. A different
map display never recalculates the price. This is not embedded turn-by-turn
navigation, Google Places, Google Routes or Apple route calculation.

## Verification

Automated checks cover platform selection, missing-key fallback, coordinate
fitting/validation, configuration isolation, types and both native JS exports.
Real Google/Apple tiles, signed native binaries, accessibility/gestures and
physical-device performance still need the [two-phone acceptance
run](device-preview.md). Check the correct provider branding, route fit,
straight-line labels, moving/stale driver pins, Hide map, background/sign-out,
and offline behavior. Keep provider attribution visible on small screens and
with enlarged text.

References: [Expo map-view setup](https://docs.expo.dev/versions/latest/sdk/map-view/)
and [react-native-maps installation](https://github.com/react-native-maps/react-native-maps/blob/master/docs/installation.md).
