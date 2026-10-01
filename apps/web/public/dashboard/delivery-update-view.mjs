import { element } from './dom.mjs';

function card(root, { alert = false, onOpen, onDismiss } = {}) {
  root.classList.add('delivery-kemmy'); root.hidden = true;
  root.setAttribute('aria-label', alert ? 'New Kemmy delivery notification' : 'Kemmy delivery assistant');
  const heading = element('div', undefined, 'delivery-kemmy-heading'), avatar = element('img');
  avatar.src = '/assets/kemmy-avatar.png'; avatar.alt = ''; avatar.width = avatar.height = 48;
  heading.append(avatar, element('strong', alert ? 'Kemmy · New delivery update' : 'Kemmy · Delivery assistant'));
  const live = element('div'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');
  const title = element('h3'), body = element('p'), note = element('p', '', 'small-note'), recorded = element('p', '', 'small-note');
  live.append(title, body); root.append(heading, live, note, recorded);
  let open, dismiss, key = '';
  if (alert) {
    const actions = element('div', undefined, 'delivery-kemmy-actions');
    open = element('button', 'View delivery', 'button button-primary button-small'); open.type = 'button'; open.addEventListener('click', onOpen);
    dismiss = element('button', 'Dismiss update', 'button button-outline button-small'); dismiss.type = 'button'; dismiss.addEventListener('click', onDismiss);
    actions.append(open, dismiss); root.append(actions);
  }
  return (notice, busy) => {
    root.hidden = !notice;
    const nextKey = notice ? `${notice.id}:${notice.body}:${notice.note}` : '';
    if (key !== nextKey) {
      key = nextKey; title.textContent = notice?.title ?? ''; body.textContent = notice?.body ?? ''; note.textContent = notice?.note ?? '';
      recorded.textContent = notice ? `Update recorded ${new Date(notice.createdAt).toLocaleString()}. Open the latest tracking view for current progress.` : '';
    }
    if (open) open.disabled = dismiss.disabled = busy;
  };
}

export function createDeliveryUpdateView({ root, banner, onOpen, onDismiss }) {
  const detail = card(root), notification = card(banner, { alert: true, onOpen, onDismiss });
  const error = element('p', '', 'small-note'); error.setAttribute('role', 'status'); root.append(error);
  const bannerError = element('p', '', 'small-note'); bannerError.setAttribute('role', 'status'); banner.append(bannerError);
  return Object.freeze({ render(state) {
    detail(state.identity && state.target ? state.update : null, state.opening);
    notification(state.identity ? state.alert : null, state.opening);
    error.textContent = state.identity && state.target ? state.error : '';
    bannerError.textContent = state.identity && state.alert ? state.error : '';
    if (state.identity && state.target && state.error) root.hidden = false;
  } });
}
