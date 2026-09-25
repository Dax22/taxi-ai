export interface Revision { cursor: string; changed: boolean }
export function createRealtimeClient(options: {
  read(cursor: string, signal: AbortSignal): Promise<Revision>;
  refresh(): Promise<unknown> | void;
  onError?(error: unknown): void;
  fallbackMs?: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  random?: () => number;
}): Readonly<{ resume(): void; pause(): void; reset(): void; refresh(): Promise<unknown> }>;
