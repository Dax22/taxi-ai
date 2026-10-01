import { insideNigeria } from '../../../../packages/shared/src/locations.mjs';

export interface DeliveryPoint { lat: number; lng: number }
export interface DeliverySuggestion { point: DeliveryPoint; line: string; areaId: string | null; attribution: string }
interface Ports {
  currentPosition(signal?: AbortSignal): Promise<DeliveryPoint>;
  locate(point: DeliveryPoint): Promise<DeliverySuggestion | null>;
  busy(value: boolean): void;
  result(value: DeliverySuggestion): void;
  error(message: string): void;
}

/** A late GPS fix or address lookup cannot undo manual edits, navigation or account disposal. */
export function createDeliveryPositionRequest(ports: Ports) {
  let operation = 0, active = true, capture: AbortController | null = null;
  const current = (value: number) => active && operation === value;
  async function run(acquire: (signal: AbortSignal) => Promise<DeliveryPoint>) {
    if (!active) return false;
    capture?.abort(); capture = new AbortController();
    const value = ++operation; ports.busy(true); ports.error('');
    try {
      const point = await acquire(capture.signal);
      if (!current(value)) return false;
      if (!insideNigeria(point)) throw new Error('Choose a delivery point in Nigeria. You can enter a Nigerian recipient’s address manually from anywhere.');
      const suggestion = await ports.locate({ lat: point.lat, lng: point.lng });
      if (!current(value)) return false;
      if (!suggestion) throw new Error('An address suggestion is unavailable. Enter the delivery address, state and town manually.');
      ports.result(suggestion); return true;
    } catch (error) {
      if (current(value)) ports.error(error instanceof Error ? error.message : 'Could not find this delivery location. Enter the address manually.');
      return false;
    } finally { if (current(value)) ports.busy(false); }
  }
  return {
    current(kind: 'self' | 'other') { return kind === 'self' ? run(ports.currentPosition) : Promise.resolve(false); },
    point(point: DeliveryPoint) { const selected = { lat: point.lat, lng: point.lng }; return run(async () => selected); },
    cancel() { operation++; capture?.abort(); if (active) ports.busy(false); },
    dispose() { active = false; operation++; capture?.abort(); },
  };
}
