/** Coordinates a selected conversation. Stale responses never cross ride/account boundaries. */
export function createConversationController({ client, view, visible = () => !document.hidden, onRead = () => {} }) {
  let current = null, generation = 0, pending = null, reading = 0;

  function reset() {
    generation++; current = null; pending = null; reading = 0;
    view.reset();
  }

  async function show(ride, user) {
    if (!user || user.role === 'admin' || !ride) { reset(); return; }
    if (current?.user.id !== user.id || current?.ride.id !== ride.id) {
      generation++; pending = null; reading = 0;
      current = { ride, user, messages: [], thread: null };
    } else { current.ride = ride; current.user = user; }
    view.open({ ride, user });
    if (!ride.driver) return;
    if (current.thread) view.render(current);
    if (pending) return pending;
    const ticket = generation, context = current;
    const work = (async () => {
      try {
        let after = context.messages.at(-1)?.sequence ?? 0, page;
        const added = [];
        do {
          page = await client.request(`/api/rides/${ride.id}/chat?after=${after}`);
          if (ticket !== generation) return;
          if (page.rideId !== ride.id || !Array.isArray(page.messages)
            || !Number.isSafeInteger(page.nextAfter) || page.nextAfter < after
            || (page.hasMore && page.nextAfter === after)) throw new Error('Unable to read this conversation. Refresh to retry.');
          added.push(...page.messages);
          after = page.nextAfter;
          if (added.length + context.messages.length > 500) throw new Error('Conversation exceeds the preview limit.');
        } while (page.hasMore);
        context.messages.push(...added);
        context.thread = page;
        view.render(context);
        if (visible() && view.isAtBottom()) await markRead();
      } catch (error) {
        if (ticket !== generation) return;
        if ([401, 403, 404].includes(error.status)) { reset(); return; }
        view.error(error.message);
      }
    })();
    pending = work;
    try { await work; } finally { if (ticket === generation) pending = null; }
  }

  function target({ rideId, userId }) {
    if (!current || current.ride.id !== rideId || current.user.id !== userId) {
      throw new Error('The selected conversation changed. Review it before sending.');
    }
    return { context: current, ticket: generation };
  }

  async function send(data) {
    const { ticket } = target(data);
    const result = await client.command(`/api/rides/${data.rideId}/chat/messages`, { body: data.body });
    if (ticket === generation) view.sent(data.body);
    return result;
  }

  async function report(data) {
    const { ticket } = target(data);
    const result = await client.request(`/api/rides/${data.rideId}/chat/messages/${data.messageId}/report`, {
      method: 'POST', data: { reason: data.reason },
    });
    if (ticket === generation) view.reported();
    return result;
  }

  async function markRead() {
    const context = current, ticket = generation;
    const throughSequence = context?.messages.at(-1)?.sequence ?? 0;
    if (!context?.thread || !visible() || !view.isAtBottom() || context.thread.readThrough >= throughSequence || reading) return;
    reading = throughSequence;
    try {
      const result = await client.request(`/api/rides/${context.ride.id}/chat/read`, { method: 'POST', data: { throughSequence } });
      if (ticket !== generation) return;
      Object.assign(context.thread, result);
      onRead(context.ride.id, result.unread);
      view.read(result.unread);
    } catch { /* Keep the unread marker and retry at the next refresh/scroll. */ }
    finally { if (ticket === generation) reading = 0; }
  }

  return Object.freeze({ show, send, report, markRead, reset });
}
