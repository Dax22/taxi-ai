import { formatNaira } from '/shared/demo-booking.mjs';
import { $, element } from './dom.mjs';
import { conversationItems, offerState } from './conversation-model.mjs';

/** Plain-text chat and server-derived fare cards. All network work is supplied as callbacks. */
export function createConversationView({ onSend, onReport, onAccept, onRead, serverNow }) {
  let current = null, busy = false, canSend = false, rendered = '', reportMessage = null;
  let offerControls = [];
  const drafts = new Map();
  const feed = $('chat-feed');
  const atEnd = () => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
  const isAtBottom = () => {
    const bounds = feed.getBoundingClientRect();
    return !$('chat-panel').hidden && bounds.bottom > 0 && bounds.bottom <= window.innerHeight + 1 && atEnd();
  };
  const keyFor = ({ ride, user }) => `${user.id}:${ride.id}`;
  function read(unread) { $('chat-unread').textContent = unread ? `${unread} unread` : 'Up to date'; }

  function tick() {
    for (const { button, label, ride, offer, userId } of offerControls) {
      const status = offerState(ride, offer, userId, serverNow());
      label.textContent = status.label;
      button.dataset.locked = String(!status.canAccept);
      button.disabled = busy || !status.canAccept;
    }
    $('chat-compose-fields').disabled = busy || !canSend;
    $('chat-report-fields').disabled = busy;
    $('chat-send').dataset.locked = String(!canSend);
    $('chat-send').disabled = busy || !canSend;
    for (const button of feed.querySelectorAll('button')) button.disabled = busy || button.dataset.locked === 'true';
  }

  function open(context) {
    const changed = !current || keyFor(current) !== keyFor(context);
    if (changed) {
      if (current) drafts.set(keyFor(current), $('chat-message').value);
      $('chat-message').value = drafts.get(keyFor(context)) ?? '';
      rendered = ''; reportMessage = null; offerControls = []; canSend = false;
      feed.replaceChildren(); $('chat-report-panel').hidden = true;
      $('chat-error').textContent = ''; $('chat-unread').textContent = 'Loading…';
    }
    current = context;
    $('chat-panel').hidden = false;
    const peer = context.user.role === 'driver' ? context.ride.customer : context.ride.driver;
    $('chat-title').textContent = peer ? `Chat with ${peer.name}` : 'Your conversation';
    $('chat-waiting').hidden = Boolean(context.ride.driver);
    $('chat-content').hidden = !context.ride.driver;
    if (!context.ride.driver) { canSend = false; $('chat-unread').textContent = 'Waiting for a driver'; }
    tick();
  }

  function render(context) {
    current = context;
    canSend = context.thread.canSend && ['negotiating', 'agreed'].includes(context.ride.status);
    read(context.thread.unread);
    $('chat-error').textContent = '';
    $('chat-compose-note').textContent = context.ride.status === 'cancelled'
      ? 'This request was cancelled. You can still read and report saved messages.'
      : !canSend ? 'This test conversation has reached its 500-message limit.'
        : 'Messages stay in Taxi Ai. Sending a message does not agree a fare.';
    const key = JSON.stringify([keyFor(context), context.ride.version, context.messages.at(-1)?.sequence,
      context.thread.reportedMessageIds]);
    if (rendered !== key) {
      const follow = !rendered || atEnd();
      const position = feed.scrollTop;
      rendered = key; offerControls = [];
      const items = conversationItems(context.ride, context.messages);
      const nodes = items.map((item) => renderItem(item, context));
      if (!nodes.length) nodes.push(element('p', 'Say hello, confirm your pickup, or discuss the fare.', 'empty-state'));
      feed.replaceChildren(...nodes);
      feed.scrollTop = follow ? feed.scrollHeight : position;
      if (!follow) $('chat-new-messages').hidden = false;
    }
    tick();
  }

  function renderItem(item, { ride, user, thread }) {
    const node = element('article', undefined, `chat-entry chat-${item.kind}`);
    const at = element('time', new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    at.dateTime = new Date(item.at).toISOString();
    if (item.kind === 'message') {
      const message = item.message, own = message.senderId === user.id;
      if (own) node.classList.add('chat-own');
      const author = own ? 'You' : message.senderId === ride.customer.id ? ride.customer.name : ride.driver.name;
      const header = element('div', undefined, 'chat-meta'); header.append(element('strong', author), at);
      node.append(header, element('p', message.body, 'chat-body'));
      if (!own) {
        const reported = thread.reportedMessageIds.includes(message.id);
        const button = element('button', reported ? 'Reported' : 'Report message', 'chat-report-button');
        button.type = 'button'; button.dataset.locked = String(reported);
        button.addEventListener('click', () => {
          reportMessage = { rideId: ride.id, userId: user.id, messageId: message.id };
          $('chat-report-preview').textContent = message.body;
          $('chat-report-panel').hidden = false;
          $('chat-report-reason').focus();
        });
        node.append(button);
      }
    } else if (item.kind === 'offer') {
      const offer = item.offer;
      const author = offer.proposedBy === user.id ? 'You offered' : `${offer.proposedBy === ride.customer.id ? ride.customer.name : ride.driver.name} offered`;
      node.append(element('p', author, 'eyebrow'), element('strong', formatNaira(offer.amountKobo), 'chat-price'), at);
      const label = element('p', '', 'small-note');
      const button = element('button', `Accept ${formatNaira(offer.amountKobo)}`, 'button button-primary button-small');
      button.type = 'button';
      button.addEventListener('click', () => onAccept(`/api/rides/${ride.id}/accept`, {
        expectedVersion: ride.version, offerId: offer.id }, 'Your fare agreement has been saved.'));
      node.append(label, button);
      offerControls.push({ button, label, ride, offer, userId: user.id });
    } else {
      node.append(element('strong', `Fare agreed: ${formatNaira(item.agreement.amountKobo)}`),
        element('p', 'Both participants confirmed this exact fare. This preview does not dispatch a car.', 'small-note'), at);
    }
    return node;
  }

  $('chat-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!current || !canSend || busy) return;
    onSend({ rideId: current.ride.id, userId: current.user.id, body: $('chat-message').value });
  });
  $('chat-report-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (reportMessage && !busy) onReport({ ...reportMessage, reason: $('chat-report-reason').value });
  });
  $('chat-report-cancel').addEventListener('click', () => { reportMessage = null; $('chat-report-panel').hidden = true; });
  feed.addEventListener('scroll', () => {
    if (isAtBottom()) { $('chat-new-messages').hidden = true; onRead(); }
  });
  window.addEventListener('scroll', () => { if (isAtBottom()) onRead(); }, { passive: true });
  $('chat-new-messages').addEventListener('click', () => { feed.scrollTop = feed.scrollHeight; $('chat-new-messages').hidden = true; onRead(); });

  return Object.freeze({ open, render, tick, isAtBottom, read,
    setBusy(value) { busy = value; tick(); },
    error(message) { $('chat-error').textContent = message; },
    sent(body) { if ($('chat-message').value === body) $('chat-message').value = ''; },
    reported() { reportMessage = null; $('chat-report-panel').hidden = true; },
    reset() {
      current = null; rendered = ''; canSend = false; reportMessage = null; offerControls = [];
      drafts.clear(); feed.replaceChildren(); $('chat-message').value = '';
      $('chat-panel').hidden = true; $('chat-report-panel').hidden = true; $('chat-new-messages').hidden = true;
      $('chat-report-preview').textContent = ''; $('chat-error').textContent = '';
    },
  });
}
