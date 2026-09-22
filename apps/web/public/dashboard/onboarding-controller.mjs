/** Private application state stays within the current account and selected applicant. */
export function createOnboardingController({ client, view, files, onDeleted = () => {} }) {
  let user = null, selected = null, application = null, generation = 0, pending = false, polling = null, error = '';
  const current = (epoch) => epoch === generation && Boolean(user && selected);
  const path = () => user.role === 'admin' ? `/api/admin/drivers/${selected}` : '/api/driver/application';
  const render = () => view.render({ user, application, pending, error });
  function acceptApplication(value) {
    if (!value || value.driverId !== selected) {
      application = null; view.reset();
      throw new Error('Your session changed. Refresh before opening the application again.');
    }
    application = value;
  }
  function reset() {
    generation++; user = selected = application = polling = null; pending = false; error = ''; view.reset(); render();
  }
  function context(account) {
    if (user?.id !== account?.id || user?.role !== account?.role) reset();
    user = ['driver', 'admin'].includes(account?.role) ? account : null;
    if (user?.role === 'driver') selected = user.id;
    render();
  }
  async function poll() {
    if (!selected || !user || pending || polling) return polling;
    const epoch = generation;
    const task = (async () => {
      try {
        const result = await client.request(path());
        if (current(epoch)) { acceptApplication(result.application); render(); }
      } catch (cause) {
        if (current(epoch)) {
          error = cause.message;
          if ([401, 403, 404].includes(cause.status)) { application = null; view.reset(); }
          render();
        }
      } finally { if (polling === task) polling = null; }
    })();
    polling = task; return task;
  }
  async function open(id) {
    if (user?.role !== 'admin') return;
    generation++; selected = id; application = polling = null; error = ''; pending = false; view.reset(); render();
    await poll(); view.focus();
  }
  async function run(action, data, file = null) {
    if (!application || pending) return;
    let accepted = false;
    const epoch = ++generation; polling = null; pending = true; error = ''; render();
    const target = action === 'delete-profile' ? '/api/account/driver-profile/delete'
      : action === 'review' ? `${path()}/review` : `/api/driver/application/${action}`;
    try {
      const payload = file ? { ...data, ...await files.read(file) } : data;
      if (!current(epoch)) return;
      const result = await client.command(target, payload);
      if (!current(epoch)) return;
      if (action === 'delete-profile') {
        if (result.user?.id !== user.id || result.user.driver) throw new Error('Your Work profile changed. Refresh and review it before deleting again.');
        reset(); await onDeleted(result.user); return;
      }
      acceptApplication(result.application); view.acceptChanges(action); accepted = true;
    } catch (cause) {
      if (current(epoch)) {
        error = cause.message;
        if ([401, 403, 404].includes(cause.status)) { application = null; view.reset(); }
      }
    } finally {
      if (current(epoch)) {
        pending = false; render();
        if (accepted && action === 'reopen') view.editVehicle?.();
        await poll();
      }
    }
  }
  async function download(id) {
    if (!application || pending) return;
    const epoch = ++generation; polling = null; pending = true; error = ''; render();
    try {
      const result = await client.request(`/api/driver-documents/${id}`);
      if (current(epoch)) {
        if (result.document?.id !== id || result.document?.driverId !== selected) throw new Error('The document does not belong to this application. Refresh and try again.');
        files.save(result);
      }
    } catch (cause) {
      if (current(epoch)) {
        error = cause.message;
        if ([401, 403, 404].includes(cause.status)) { application = null; view.reset(); }
      }
    } finally { if (current(epoch)) { pending = false; render(); await poll(); } }
  }
  return Object.freeze({ context, reset, open, poll, run, download,
    async editVehicle() {
      if (user?.role !== 'driver') return false;
      const epoch = generation;
      view.focus();
      if (!application && !pending) { error = ''; render(); await poll(); }
      if (!current(epoch)) return false;
      if (!application) {
        error ||= 'Unable to load your driver profile. Check your connection and try Edit / change vehicle again.';
        render(); return false;
      }
      return view.editVehicle?.() ?? false;
    },
    focus() { if (user && application) view.focus(); }, close() {
    generation++; selected = application = polling = null; pending = false; error = ''; view.reset(); render();
  } });
}
