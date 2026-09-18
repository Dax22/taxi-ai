/** Presentation rules only. The server remains authoritative for acceptance. */
export function offerState(ride, offer, userId, now) {
  if (ride.negotiation?.agreement?.offerId === offer.id) return { label: 'Fare agreed', canAccept: false };
  if (ride.status === 'cancelled') return { label: 'Request cancelled', canAccept: false };
  if (ride.negotiation?.currentOffer?.id !== offer.id) return { label: 'Replaced by a newer offer', canAccept: false };
  if (ride.status !== 'negotiating') return { label: 'Conversation ended', canAccept: false };
  if (offer.expiresAt <= now) return { label: 'Offer expired', canAccept: false };
  return { label: offer.proposedBy === userId ? 'Waiting for the other person' : 'Current offer',
    canAccept: offer.proposedBy !== userId };
}

export function conversationItems(ride, messages) {
  const items = messages.map((message) => ({ kind: 'message', id: message.id, at: message.createdAt, rank: 0, order: message.sequence, message }));
  for (const [order, offer] of (ride.negotiation?.offers ?? []).entries()) {
    items.push({ kind: 'offer', id: offer.id, at: offer.createdAt, rank: 1, order, offer });
  }
  const agreement = ride.negotiation?.agreement;
  if (agreement) items.push({ kind: 'agreement', id: `agreement:${agreement.offerId}`, at: agreement.agreedAt, rank: 2, order: 0, agreement });
  return items.sort((a, b) => a.at - b.at || a.rank - b.rank || a.order - b.order);
}
