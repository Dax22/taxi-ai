// A visual reflection of the selected service. This never changes a booking.
const scene = document.querySelector('[data-page-scene-context="booking"]');
const courier = document.getElementById('booking-service-courier');
if (scene && courier) {
  const reflectService = () => {
    scene.dataset.pageScene = courier.getAttribute('aria-pressed') === 'true' ? 'courier' : 'rides';
  };
  // The account controller sets the service from the URL when it loads.
  scene.dataset.pageScene = new URLSearchParams(location.search).get('service') === 'courier' ? 'courier' : 'rides';
  const observer = new MutationObserver(reflectService);
  const observe = () => observer.observe(courier, { attributes: true, attributeFilter: ['aria-pressed'] });
  observe();
  window.addEventListener('pagehide', () => observer.disconnect());
  window.addEventListener('pageshow', () => { reflectService(); observe(); });
}
