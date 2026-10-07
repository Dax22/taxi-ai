import { createContactApi } from './contact-api.mjs';

const api = createContactApi();
const form = document.getElementById('contact-form');
const submit = document.getElementById('contact-submit');
const submitLabel = document.getElementById('contact-submit-label');
const status = document.getElementById('contact-form-status');
const fields = ['name', 'email', 'message', 'website'].map((name) => form.elements.namedItem(name));
let available = false;
let sending = false;

function showStatus(message, tone = '') {
  status.textContent = message;
  status.dataset.tone = tone;
}

function setSending(value) {
  sending = value;
  form.setAttribute('aria-busy', String(value));
  submit.disabled = value || !available;
  submitLabel.textContent = value ? 'Sending…' : 'Send message';
  for (const field of fields) field.disabled = value;
}

async function loadAvailability() {
  try {
    available = await api.available();
  } catch {
    available = false;
  }
  submit.disabled = !available;
  showStatus(available ? '' : 'Online messaging is temporarily unavailable. Please email us directly using the link below.');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (sending || !available || !form.reportValidity()) return;

  const data = Object.fromEntries(fields.map((field) => [field.name, field.name === 'website' ? field.value : field.value.trim()]));
  if (!data.name || data.message.length < 10) {
    showStatus(!data.name ? 'Please enter your name.' : 'Please write a message of at least 10 characters.', 'error');
    form.elements.namedItem(!data.name ? 'name' : 'message').focus();
    return;
  }

  setSending(true);
  showStatus('Sending your message…');
  try {
    const response = await api.send(data);
    const result = response.body;
    if (response.ok && result?.sent === true) {
      form.reset();
      showStatus('Your message has been sent to info@taxiai.app. Thank you for getting in touch.', 'success');
    } else if (response.status === 503) {
      showStatus('Online messaging is temporarily unavailable. Your details are still here. Please try again later or email us directly.', 'error');
    } else {
      const message = typeof result?.error?.message === 'string' ? result.error.message : 'We couldn’t send your message. Please try again or email us directly.';
      showStatus(message, 'error');
    }
  } catch {
    showStatus('We couldn’t confirm that your message was sent. Your details are still here. Check your connection, or email us directly.', 'error');
  } finally {
    setSending(false);
  }
});

void loadAvailability();
