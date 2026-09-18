import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { requireRole } from '../../shared/policies.mjs';

/** Driver approval owns its rules; account names are read through an injected port. */
export function createDriversService({ repository, getAccount, unitOfWork, audit, clock }) {
  function view(driver) { return { ...driver, name: getAccount(driver.id).name }; }
  function list(user) {
    requireRole(user, 'admin');
    return repository.list().map(view);
  }
  function review(user, id, data) {
    requireRole(user, 'admin');
    fields(data, ['decision']);
    check(['approved', 'rejected'].includes(data.decision), 'INVALID_DECISION', 'Choose approved or rejected.');
    return unitOfWork(() => {
      const driver = repository.find(id);
      check(driver, 'NOT_FOUND', 'Driver application not found.');
      if (driver.status !== data.decision) {
        check(driver.status === 'pending', 'ALREADY_REVIEWED', 'This application has already been reviewed.');
        const now = clock();
        repository.review(id, data.decision, user.id, now);
        audit.record(user.id, `driver.${data.decision}`, id, now);
      }
      return view(repository.find(id));
    });
  }
  return Object.freeze({ list, review });
}
