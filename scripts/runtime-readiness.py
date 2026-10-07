#!/usr/bin/env python3
"""Read-only diagnostics inside the active app. No deploy, restart or settings edit."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def main():
    script = Path(__file__).with_suffix('.mjs').read_text()
    command = ['docker', 'exec', '-i', '-w', '/app', 'taxi-ai-staging-app-1',
               'node', '--experimental-sqlite', '--input-type=module']
    try:
        result = subprocess.run(command, input=script + '\nawait main();\n',
                                capture_output=True, text=True, timeout=30)
        if result.returncode:
            if 'permission denied' in result.stderr.lower():
                print('BLOCKED: Docker access requires an authorized server operator. No settings were changed.')
            else:
                print('BLOCKED: Runtime diagnostics could not execute. No settings were changed.')
            return 2
        report = json.loads(result.stdout)
        if not isinstance(report.get('configuration'), dict):
            raise ValueError('Unexpected report')
    except Exception:
        print('BLOCKED: Runtime diagnostics unavailable. No settings were changed.')
        return 2
    # Only the deliberately redacted report is saved. Never store inspect output or env files.
    fd, filename = tempfile.mkstemp(prefix='taxi-ai-readiness-', suffix='.json', dir='/var/tmp')
    with os.fdopen(fd, 'w') as output:
        os.fchmod(output.fileno(), 0o644)
        json.dump(report, output, indent=2)
        output.write('\n')
    print('READINESS_REPORT=' + filename)
    print(json.dumps(report, indent=2))
    return 0 if report.get('databaseRead') == 'ok' else 2


if __name__ == '__main__':
    sys.exit(main())
