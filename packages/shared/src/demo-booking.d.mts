export interface DemoArea { id: string; name: string }
export const DEMO_AREAS: readonly Readonly<DemoArea>[];
export function matchSampleArea<T extends DemoArea>(areas: readonly T[], text: string): T | null;
export function createDemoQuote(pickupId: string, destinationId: string): {
  pickup: Readonly<DemoArea>; destination: Readonly<DemoArea>; suggestedFareKobo: number; currency: 'NGN'; isDemo: true;
};
export function nairaToKobo(value: string): number;
export function formatNaira(kobo: number): string;
