/** Browser access only after an explicit sharing action; callbacks are scoped by the controller. */
export function createGeolocation({ device = globalThis.navigator?.geolocation, secure = globalThis.isSecureContext } = {}) {
  const options = { enableHighAccuracy: true, maximumAge: 5000, timeout: 10_000 };
  return Object.freeze({
    supported: () => Boolean(secure && device),
    locate: () => new Promise((resolve, reject) => device.getCurrentPosition(resolve, reject, options)),
    watch(onFix, onError) { const id = device.watchPosition(onFix, onError, options); return () => device.clearWatch(id); },
  });
}
