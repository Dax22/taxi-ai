/** Business-rule failure; consumers can use the stable code without parsing text. */
export class FareError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FareError';
    this.code = code;
  }
}

function requireRule(condition, code, message) {
  if (!condition) throw new FareError(code, message);
}

function requireId(value) {
  requireRule(typeof value === 'string' && value.trim().length > 0,
    'INVALID_ID', 'IDs must be nonempty strings.');
}

function requireAmount(value) {
  requireRule(Number.isSafeInteger(value) && value > 0,
    'INVALID_AMOUNT', 'A fare must be a positive safe integer in kobo.');
}

function requireTimestamp(value) {
  requireRule(Number.isSafeInteger(value) && value >= 0,
    'INVALID_TIME', 'Time must be a nonnegative safe integer in milliseconds.');
}

/**
 * In-memory domain model, not an authentication or persistence boundary.
 * The future API must derive actorId from its authenticated session and persist
 * version checks atomically. See docs/architecture.md.
 */
export class FareNegotiation {
  #state;
  #lastChangedAt;

  constructor({ id, customerId, driverId, suggestedFareKobo = null,
    now = Date.now() }) {
    [id, customerId, driverId].forEach(requireId);
    requireRule(customerId !== driverId, 'INVALID_PARTICIPANTS',
      'Customer and driver must be different participants.');
    if (suggestedFareKobo !== null) requireAmount(suggestedFareKobo);
    requireTimestamp(now);

    this.#lastChangedAt = now;
    this.#state = {
      id,
      customerId,
      driverId,
      currency: 'NGN',
      suggestedFareKobo,
      status: 'open',
      version: 0,
      currentOffer: null,
      offers: [],
      agreement: null,
      cancellation: null,
    };
  }

  snapshot() {
    return structuredClone(this.#state);
  }

  #assertCommand({ actorId, expectedVersion, now }) {
    requireRule(actorId === this.#state.customerId || actorId === this.#state.driverId,
      'FORBIDDEN', 'Only this negotiation\'s participants can act.');
    requireRule(this.#state.status === 'open', 'NEGOTIATION_CLOSED',
      'This negotiation has already ended.');
    requireRule(Number.isSafeInteger(expectedVersion)
      && expectedVersion === this.#state.version,
    'STALE_VERSION', 'Reload the current negotiation before trying again.');
    requireTimestamp(now);
    requireRule(now >= this.#lastChangedAt, 'INVALID_TIME',
      'Command time cannot precede the last state change.');
  }

  /** Sending an offer is the sender's explicit consent to that amount. */
  propose({ actorId, amountKobo, expectedVersion, channel = 'in_app',
    now = Date.now(), validForMs = 120_000 }) {
    this.#assertCommand({ actorId, expectedVersion, now });
    requireAmount(amountKobo);
    requireRule(['in_app', 'chat', 'voice_call'].includes(channel),
      'INVALID_CHANNEL', 'Use in_app, chat or voice_call.');
    requireRule(Number.isSafeInteger(validForMs) && validForMs > 0
      && Number.isSafeInteger(now + validForMs),
    'INVALID_EXPIRY', 'Offer lifetime must be a positive, representable duration.');

    const nextVersion = this.#state.version + 1;
    const offer = {
      id: `${this.#state.id}:offer:${nextVersion}`,
      proposedBy: actorId,
      amountKobo,
      currency: 'NGN',
      channel,
      createdAt: now,
      expiresAt: now + validForMs,
    };
    this.#state.currentOffer = offer;
    this.#state.offers.push(offer);
    this.#state.version = nextVersion;
    this.#lastChangedAt = now;
    return this.snapshot();
  }

  /** Only the other participant may accept the exact current, unexpired offer. */
  accept({ actorId, offerId, expectedVersion, now = Date.now() }) {
    this.#assertCommand({ actorId, expectedVersion, now });
    const offer = this.#state.currentOffer;
    requireRule(offer !== null, 'NO_OFFER', 'There is no fare offer to accept.');
    requireRule(offerId === offer.id, 'STALE_OFFER',
      'Only the current fare offer can be accepted.');
    requireRule(actorId !== offer.proposedBy, 'SELF_ACCEPTANCE',
      'The other participant must accept this offer.');
    requireRule(now < offer.expiresAt, 'OFFER_EXPIRED',
      'This offer has expired. Send a new offer to continue.');

    this.#state.agreement = {
      offerId: offer.id,
      amountKobo: offer.amountKobo,
      currency: 'NGN',
      proposedBy: offer.proposedBy,
      acceptedBy: actorId,
      confirmedBy: [offer.proposedBy, actorId],
      agreedAt: now,
      originChannel: offer.channel,
    };
    this.#state.status = 'agreed';
    this.#state.version += 1;
    this.#lastChangedAt = now;
    return this.snapshot();
  }

  /** Cancels an open negotiation only; trip cancellation is a separate workflow. */
  cancel({ actorId, expectedVersion, now = Date.now() }) {
    this.#assertCommand({ actorId, expectedVersion, now });
    this.#state.cancellation = { cancelledBy: actorId, cancelledAt: now };
    this.#state.status = 'cancelled';
    this.#state.version += 1;
    this.#lastChangedAt = now;
    return this.snapshot();
  }
}
