import { $, element } from './dom.mjs';

export function createKemmySetup({ client, onDriver = () => {}, onCustomer = () => {}, onSeller = () => {}, navigate = (path) => location.assign(path), delayMs = 3000 }) {
  let identity = null, timer = null, generation = 0, busy = false, state = null;
  const root = $('kemmy-setup-card'), launcher = $('kemmy-setup-launcher'), actions = $('kemmy-setup-actions');

  function clearTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
  function hide() { root.hidden = true; }
  function showLauncher(value = true) { launcher.hidden = !value || !identity; }
  function button(label, handler, secondary = false) {
    const value = element('button', label, secondary ? 'button button-outline button-small' : 'button button-primary button-small');
    value.type = 'button'; value.addEventListener('click', handler); actions.append(value); return value;
  }
  function link(label, href) {
    const value = element('a', label, 'button button-primary button-small'); value.href = href; actions.append(value); return value;
  }
  function message(text, note = '') { $('kemmy-setup-message').textContent = text; $('kemmy-setup-note').textContent = note; }

  async function update(action, value) {
    if (!identity || busy) return null;
    const epoch = generation; busy = true; root.setAttribute('aria-busy','true');
    for (const control of actions.querySelectorAll('button,a')) control.setAttribute('aria-disabled','true');
    try {
      const next = await client.request('/api/account/kemmy-setup', { method: 'POST', data: { action, ...(value === undefined ? {} : { value }) } });
      if (epoch !== generation) return null;
      state = next; render(next); return next;
    } catch (error) {
      if (epoch === generation) $('kemmy-setup-note').textContent = error.message;
      return null;
    } finally {
      if (epoch === generation) { busy = false; root.setAttribute('aria-busy','false'); }
    }
  }

  function render(next) {
    actions.replaceChildren(); state = next;
    if (!identity) { hide(); showLauncher(false); return; }
    root.hidden = false; showLauncher(false);
    if (next.nextStep === 'welcome') {
      message("Hi, my name is Kemmy and I’m your Taxi Ai assistant. I can help you set up your account.", 'This guided setup uses fixed Taxi Ai rules. It does not use an AI language model.');
      button('Set up my account', () => void update('start'));
      button('Maybe later', () => void dismiss(), true);
    } else if (next.nextStep === 'email') {
      message('First, let’s make sure you can recover your account.', 'Verify your email when account email delivery is available, or continue and return to this later.');
      link('Verify my email', '/account-access');
      button('Do this later', () => void update('email-later'), true);
    } else if (next.nextStep === 'experience') {
      message('How would you like to use Taxi Ai first?', 'This does not lock your account. You can still use Ride, Eats, Courier and Work features later.');
      button('Book rides & deliveries', async () => { if (await update('experience','customer')) onCustomer(); });
      button('Drive & deliver', async () => { if (await update('experience','driver')) onDriver(); }, true);
      button('Sell food', async () => { if (await update('experience','eats_seller')) onSeller(); }, true);
    } else if (next.nextStep === 'notifications') {
      message('Stay informed about journeys and Taxi Ai announcements.', 'Your in-app Updates inbox works without phone push alerts.');
      button('Use in-app updates', () => void update('notifications','in_app'));
      button('Set up phone alerts later', () => void update('notifications','later'), true);
    } else if (next.nextStep === 'safety') {
      message('Would you like to review Family Safety and trusted contacts?', 'Trusted contacts are optional and can be changed later.');
      button('Open Family Safety', async () => { if (await update('safety','review')) navigate('/family'); });
      button('Do this later', () => void update('safety','later'), true);
    } else if (next.nextStep === 'finish') {
      message('You’re ready to use Taxi Ai.', 'Kemmy can still guide your journeys after setup.');
      button('Finish setup', () => void update('complete'));
    } else {
      message('How can I help?', 'Your account setup is complete. Choose where you want to go, or review setup again.');
      button('Book a ride', () => { hide(); showLauncher(true); onCustomer(); });
      button('Open Taxi Ai Eats', () => navigate('/eats'), true);
      button('Send a parcel', () => navigate('/app?service=courier'), true);
      button('Review setup again', () => void update('restart'), true);
    }
  }

  async function load(auto = false) {
    if (!identity || busy) return;
    const epoch = generation; busy = true;
    try {
      const next = await client.request('/api/account/kemmy-setup');
      if (epoch !== generation) return;
      state = next;
      if (auto && !next.autoOpen) { hide(); showLauncher(true); return; }
      render(next);
    } catch { if (epoch === generation) { hide(); showLauncher(false); } }
    finally { if (epoch === generation) busy = false; }
  }

  async function dismiss() {
    const next = await update('dismiss');
    if (!next) return; hide(); showLauncher(true);
  }

  $('kemmy-setup-dismiss').addEventListener('click', () => void dismiss());
  launcher.addEventListener('click', async () => { const next = await update('resume'); if (next) render(next); });

  return Object.freeze({
    context(nextIdentity) {
      if (identity === nextIdentity) return;
      generation++; clearTimer(); identity = nextIdentity; state = null; busy = false; hide(); showLauncher(false);
      if (identity) timer = setTimeout(() => { timer = null; void load(true); }, delayMs);
    },
    refresh: () => load(false),
    reset() { generation++; clearTimer(); identity = null; state = null; busy = false; hide(); showLauncher(false); },
  });
}
