import { safeCheckoutUrl } from '../../../../packages/shared/src/checkout-payments.mjs';
import type { CheckoutPaymentDetail, CheckoutPaymentKind } from '../../../../packages/shared/src/checkout-payments.mjs';

type Action = 'start' | 'refresh';
type Command = { action: Action; expectedVersion: number; key: string };
interface Api {
  checkoutPayment(kind: CheckoutPaymentKind, targetId: string): Promise<CheckoutPaymentDetail>;
  checkoutPaymentCommand(kind: CheckoutPaymentKind, targetId: string, action: Action, expectedVersion: number, key: string): Promise<CheckoutPaymentDetail>;
}
export interface CheckoutState {
  detail: CheckoutPaymentDetail | null; loading: boolean; busy: boolean; stale: boolean; uncertain: boolean;
  returned: boolean; error: string;
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Test payment could not connect. Try again.';

/** No redirects, persisted checkout secrets or automatic payment verification. Each write keeps its reviewed version and key. */
export class CheckoutPaymentController {
  private active = false;
  private disposed = false;
  private generation = 0;
  private reading = false;
  private running = false;
  private pending: Command | null = null;
  private listeners = new Set<() => void>();
  private state: CheckoutState = { detail: null, loading: false, busy: false, stale: true, uncertain: false, returned: false, error: '' };
  private api: Api;
  readonly kind: CheckoutPaymentKind;
  readonly targetId: string;
  private key: () => string;
  constructor(api: Api, kind: CheckoutPaymentKind, targetId: string, key: () => string) {
    this.api = api; this.kind = kind; this.targetId = targetId; this.key = key;
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(value: Partial<CheckoutState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...value };
    for (const listener of this.listeners) listener();
  }
  activate() {
    if (this.disposed) return;
    this.active = true;
    this.patch({ busy: this.running, uncertain: Boolean(this.pending) });
    void this.load();
  }
  pause() {
    this.active = false; this.generation++;
    this.patch({ detail: null, loading: false, busy: false, stale: true, uncertain: Boolean(this.pending), error: '' });
  }
  dispose() {
    this.pause(); this.pending = null; this.disposed = true;
    this.state = { ...this.state, detail: null, uncertain: false, returned: false };
    this.listeners.clear();
  }
  async load(preserveError = false) {
    if (!this.active || this.disposed || this.reading || this.running || this.pending) return;
    const epoch = this.generation;
    this.reading = true; this.patch({ loading: true });
    try {
      const detail = await this.api.checkoutPayment(this.kind, this.targetId);
      if (this.active && !this.disposed && epoch === this.generation)
        this.patch({ detail, stale: false, ...(preserveError ? {} : { error: '' }) });
    } catch (error) {
      if (this.active && !this.disposed && epoch === this.generation) this.patch({ detail: null, stale: true, error: message(error) });
    } finally {
      this.reading = false;
      if (this.active && !this.disposed) {
        this.patch({ loading: false });
        if (epoch !== this.generation) void this.load();
      }
    }
  }
  checkoutUrl(): string | null {
    const detail = this.state.detail;
    if (!this.active || this.disposed || this.state.stale || this.running || this.reading || this.pending || !detail?.isPayer
      || detail.payment?.status !== 'pending') return null;
    return safeCheckoutUrl(detail.payment.checkoutUrl);
  }
  markCheckoutOpened() { if (this.checkoutUrl()) this.patch({ returned: true }); }
  reportError(error: unknown) { if (this.active && !this.disposed) this.patch({ error: message(error) }); }
  async act(action: Action) {
    const detail = this.state.detail;
    if (!this.active || this.disposed || this.running || this.reading || this.pending || this.state.stale || !detail?.isPayer) return;
    if (action === 'start' ? !detail.canStart : !detail.payment) return;
    this.pending = { action, expectedVersion: detail.payment?.version ?? 0, key: this.key() };
    await this.run();
  }
  async retry() { if (this.active && !this.disposed && this.pending && !this.running && !this.reading) await this.run(); }
  private async run() {
    const command = this.pending;
    if (!command) return;
    const epoch = this.generation;
    let reload = false;
    this.running = true; this.patch({ busy: true, error: '' });
    try {
      const detail = await this.api.checkoutPaymentCommand(this.kind, this.targetId, command.action, command.expectedVersion, command.key);
      if (!this.active || this.disposed || epoch !== this.generation) return;
      this.pending = null;
      this.patch({ detail, stale: false, uncertain: false, returned: command.action === 'refresh' ? false : this.state.returned });
    } catch (error) {
      if (!this.active || this.disposed || epoch !== this.generation) return;
      const status = (error as { status?: number })?.status;
      if (typeof status === 'number' && status >= 400 && status < 500) {
        this.pending = null; reload = true;
        this.patch({ detail: null, stale: true, uncertain: false, error: message(error) });
      } else this.patch({ detail: null, stale: true, uncertain: true, error: 'Confirmation was interrupted. Retry the same test payment action to check its result.' });
    } finally {
      this.running = false;
      if (this.active && !this.disposed) this.patch({ busy: false });
      if (reload) void this.load(true);
    }
  }
}
