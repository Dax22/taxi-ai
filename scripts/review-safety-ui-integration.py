#!/usr/bin/env python3
"""Review-only by default. Apply these source edits manually as ubuntu, never as root.
This does not grant privileges, alter agent policy, change /opt, or use Docker.
"""
import argparse
import difflib
import os
from pathlib import Path

ROOT = Path('/home/ubuntu/taxi-ai-admin-20261004')

def proposed():
    changes = {}
    originals = {}
    def edit(name, old, new):
        path = ROOT / name
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT):
            raise RuntimeError('Refusing a source path outside the development checkout.')
        originals.setdefault(name, path.read_text())
        source = changes.get(name, originals[name])
        if source.count(old) != 1:
            raise RuntimeError(name + ': source changed; review the edit before proceeding.')
        changes[name] = source.replace(old, new, 1)
    edit('apps/admin/public/command-center-navigation.mjs', 'export const commandSections={', "export const commandSections={\n 'safety-alerts':['Safety alerts','Possible crash, loud distress and manual panic reports.','cases.safety','safetyAlerts'],")
    edit('apps/admin/public/command-center-navigation.mjs', "['people','businesses','work','restrictions'].includes(section)", "['people','businesses','work','restrictions','safety-alerts'].includes(section)")
    edit('apps/admin/public/command-center-navigation.mjs', "restrictions:'restrictionDetail'}[section]", "restrictions:'restrictionDetail','safety-alerts':'safetyAlertDetail'}[section]")
    edit('apps/admin/public/pages.mjs', 'import { operations }', "import { safetyAlerts, safetyAlertDetail } from './safety-alert-pages.mjs';\nimport { operations }")
    edit('apps/admin/public/pages.mjs', '=> ({ transactions, transactionDetail,', '=> ({ safetyAlerts, safetyAlertDetail, transactions, transactionDetail,')
    edit('apps/admin/public/index.html', '<a href="/admin/cases" data-section="cases">', '<a href="/admin/safety-alerts" data-section="safety-alerts"><span aria-hidden="true">!</span>Safety alerts</a>\n        <a href="/admin/cases" data-section="cases">')
    edit('apps/admin/public/app.mjs', "route.name === 'operations' &&", "['operations', 'safetyAlerts', 'safetyAlertDetail'].includes(route.name) &&")
    edit('apps/admin/public/app.mjs', '  }, 30000);', "  }, route.section === 'safety-alerts' ? 10000 : 30000);")
    edit('apps/admin/public/app.mjs', '\nvoid controller.load(); schedule();', '''\n// Expire a current-location view even while a reviewer is typing.
if (route.section === 'safety-alerts') setInterval(() => {
  for (const node of document.querySelectorAll('[data-safety-current="true"]')) {
    if (Date.now() - Number(node.getAttribute('data-received-at')) >= 30000) {
      node.replaceChildren(document.createTextNode('Current-location view expired. Refresh to verify sharing access. Incident evidence is historical.'));
      node.removeAttribute('data-safety-current');
    }
  }
}, 1000);
void controller.load(); schedule();''')
    edit('apps/web/server.mjs', "'/admin/restriction-impact'].map", "'/admin/restriction-impact', '/admin/safety-alerts'].map")
    edit('apps/web/server.mjs', "'moderation-pages'].map", "'moderation-pages', 'safety-alert-pages', 'safety-alert-map'].map")
    edit('apps/web/server.mjs', 'people|businesses|work|restrictions)', 'people|businesses|work|restrictions|safety-alerts)')
    edit('apps/web/server.mjs', "pathname.startsWith('/admin/live/'))", "pathname.startsWith('/admin/live/') || pathname.startsWith('/admin/safety-alerts/'))")
    edit('services/api/src/modules/safety-monitoring/service.mjs', 'isTest:simulation === true,driver:', 'isTest:simulation === true ? true : null,driver:')
    edit('services/api/src/modules/safety-monitoring/service.mjs', "const result=await provider.send({idempotencyKey:job.id,recipient:JSON.parse(job.recipientJson),alert:{id:a.id,kind:a.kind,unverified:true,...snapshot}});", '''// Staff-only snapshot fields do not widen the external notification payload.
        const {rideId,passenger,driver,reporter,pickup,destination,location,recordedAt}=snapshot;
        const result=await provider.send({idempotencyKey:job.id,recipient:JSON.parse(job.recipientJson),alert:{id:a.id,kind:a.kind,unverified:true,rideId,passenger,driver,reporter,pickup,destination,location,recordedAt}});''')
    edit('services/api/src/modules/admin-safety-alerts/service.mjs', "const parse = raw => { try { return JSON.parse(raw); } catch { return {}; } };", "const parse = raw => { try { const value = JSON.parse(raw); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } };")
    edit('services/api/src/modules/admin-safety-alerts/service.mjs', 'const passenger = { ...person(s.passenger), phone:', "const passenger = { ...person(s.passenger), contact: s.passenger?.kind === 'account' ? contact(customer) : null, phone:")
    return originals, changes

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply-reviewed-source', action='store_true', help='Apply reviewed development-source changes; not a deployment.')
    args = parser.parse_args()
    if os.geteuid() == 0:
        parser.error('Run as ubuntu without sudo; this script does not operate on production.')
    originals, changes = proposed()
    for name, source in changes.items():
        print(''.join(difflib.unified_diff(originals[name].splitlines(True), source.splitlines(True), fromfile='a/' + name, tofile='b/' + name)))
    if not args.apply_reviewed_source:
        print('REVIEW ONLY: no source files or services changed.'); return
    # Validate every file again before any write. Retain a unique before-copy.
    backup = ROOT / 'verification' / 'before-reviewed-safety-ui'
    backup.mkdir(mode=0o700, exist_ok=False)
    for name, original in originals.items():
        if (ROOT / name).read_text() != original:
            raise RuntimeError('Source changed during review; no source edits applied.')
    written = []
    try:
        for name, source in changes.items():
            saved = backup / name; saved.parent.mkdir(parents=True, exist_ok=True)
            saved.write_text(originals[name]); (ROOT / name).write_text(source); written.append(name)
    except Exception:
        for name in written:
            (ROOT / name).write_text(originals[name])
        raise
    print('Development UI wiring applied. Run tests before committing or deploying. No production settings, agent permissions or live services changed.')

if __name__ == '__main__':
    main()
