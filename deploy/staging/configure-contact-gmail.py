#!/usr/bin/env python3
"""Configure contact delivery privately from an interactive server terminal."""

import argparse
import getpass
import json
import os
from pathlib import Path
import re
import smtplib
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import warnings

ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / "deploy/staging/.env"
COMPOSE_FILE = ROOT / "deploy/staging/compose.yml"
COMPOSE = ["docker", "compose", "--env-file", str(ENV_FILE), "-f", str(COMPOSE_FILE)]
APP = "taxi-ai-staging-app-1"
GATEWAY = "taxi-ai-staging-gateway-1"
SENDER = "daxfinn@gmail.com"
ORIGIN = "https://taxiai.app"
CONTACT_KEYS = (
    "TAXI_AI_CONTACT_EMAIL_MODE", "TAXI_AI_CONTACT_SMTP_HOST", "TAXI_AI_CONTACT_SMTP_PORT",
    "TAXI_AI_CONTACT_SMTP_USER", "TAXI_AI_CONTACT_SMTP_PASSWORD", "TAXI_AI_CONTACT_SMTP_FROM",
)
ASSIGNMENT = re.compile(r"^[ \t]*(?:export[ \t]+)?(" + "|".join(CONTACT_KEYS) + r")[ \t]*=")


def run(arguments, timeout=120):
    # Docker diagnostics can include resolved configuration; never print them.
    return subprocess.run(arguments, cwd=ROOT, stdin=subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          check=True, timeout=timeout).stdout


def inspect(name):
    return json.loads(run(["docker", "inspect", name], timeout=10))[0]


def environment(container):
    return dict(value.split("=", 1) for value in container["Config"]["Env"])


def non_contact_environment(container):
    return sorted(value for value in container["Config"]["Env"]
                  if value.split("=", 1)[0] not in CONTACT_KEYS)


def atomic_env(data):
    descriptor, filename = tempfile.mkstemp(prefix=".contact-env-", dir=ENV_FILE.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(filename, ENV_FILE)
    finally:
        if os.path.exists(filename):
            os.unlink(filename)


def updated_env(original, values):
    # Preserve every non-contact line, including its existing line ending.
    lines, replaced = [], set()
    for line in original.decode("utf-8").splitlines(keepends=True):
        match = ASSIGNMENT.match(line)
        if not match:
            lines.append(line)
            continue
        key = match.group(1)
        if key not in replaced:
            ending = "\r\n" if line.endswith("\r\n") else "\n"
            lines.append(f'{key}="{values[key]}"{ending}')
            replaced.add(key)
    missing = [key for key in CONTACT_KEYS if key not in replaced]
    if missing and lines and not lines[-1].endswith(("\n", "\r")):
        lines.append("\n")
    lines.extend(f'{key}="{values[key]}"\n' for key in missing)
    return "".join(lines).encode("utf-8")


def healthy(timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        container = inspect(APP)
        if container["State"].get("Health", {}).get("Status") == "healthy":
            run(["docker", "exec", APP, "node", "scripts/healthcheck.mjs"], timeout=10)
            return container
        time.sleep(min(3, max(0, deadline - time.monotonic())))
    raise RuntimeError("Application did not become healthy")


def http_check(path, expected, method="GET", return_status=False):
    request = urllib.request.Request(ORIGIN + path, method=method)
    try:
        response = urllib.request.urlopen(request, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        expected_codes = (expected,) if isinstance(expected, int) else tuple(expected)
        if response.status not in expected_codes or response.geturl() != ORIGIN + path:
            raise RuntimeError("Unexpected public response")
        body = response.read(16_384)
        return (response.status, body) if return_status else body


def account_access():
    """Read anonymous access without submitting a registration or changing an account."""
    status, raw = http_check("/api/session", (200, 401), return_status=True)
    body = json.loads(raw)
    if not isinstance(body, dict):
        raise RuntimeError("Unexpected anonymous session response")
    if status == 200 and "user" in body and body["user"] is None:
        return "public"
    error = body.get("error")
    if status == 401 and isinstance(error, dict) and error.get("code") == "STAGING_ACCESS_REQUIRED":
        return "invited-only"
    raise RuntimeError("Could not establish existing account access")


def verify_account_access(expected):
    if account_access() != expected:
        raise RuntimeError("Account access changed during contact setup")


def verify_preserved(before, after, gateway_id):
    if before["Image"] != after["Image"]:
        raise RuntimeError("Application image changed")
    if non_contact_environment(before) != non_contact_environment(after):
        raise RuntimeError("Non-contact environment changed")
    for key in ["Binds", "PortBindings", "ReadonlyRootfs", "CapDrop", "SecurityOpt",
                "Memory", "NanoCpus", "PidsLimit", "RestartPolicy", "Tmpfs"]:
        if before["HostConfig"].get(key) != after["HostConfig"].get(key):
            raise RuntimeError("Application settings changed")
    if inspect(GATEWAY)["Id"] != gateway_id:
        raise RuntimeError("Gateway changed")


def main():
    global ROOT, ENV_FILE, COMPOSE_FILE, COMPOSE
    parser = argparse.ArgumentParser(description=(
        "Enable only Taxi Ai contact-form email using a Google app password entered privately. "
        "Run with sudo in an interactive server terminal; never put the password in a command or chat."))
    parser.add_argument("--project-root", type=Path, default=ROOT,
                        help="Existing deployed project root; no source files are rebuilt or copied.")
    arguments = parser.parse_args()
    ROOT = arguments.project_root.resolve()
    ENV_FILE = ROOT / "deploy/staging/.env"
    COMPOSE_FILE = ROOT / "deploy/staging/compose.yml"
    COMPOSE = ["docker", "compose", "--env-file", str(ENV_FILE), "-f", str(COMPOSE_FILE)]
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        print("Run this helper directly in an interactive server terminal. No password was requested.", file=sys.stderr)
        return 1
    if os.geteuid() != 0:
        print("Run this helper with sudo on the existing Taxi Ai server.", file=sys.stderr)
        return 1

    changed = False
    backup = None
    try:
        if ENV_FILE.is_symlink() or not ENV_FILE.is_file():
            raise RuntimeError("Expected private environment file is missing")
        original = ENV_FILE.read_bytes()
        before, gateway = inspect(APP), inspect(GATEWAY)
        if before["State"].get("Health", {}).get("Status") != "healthy":
            raise RuntimeError("Existing application is not healthy")
        run(COMPOSE + ["config", "--quiet"])
        current_hash = run(COMPOSE + ["config", "--hash", "app"]).decode().split()[-1]
        if current_hash != before["Config"]["Labels"].get("com.docker.compose.config-hash"):
            raise RuntimeError("Existing Compose configuration differs from the running application")
        if not all(key in environment(before) for key in CONTACT_KEYS):
            raise RuntimeError("Deploy contact-form configuration support first")
        access_before = account_access()

        print(f"Contact mail will use {SENDER}. Account email and public registration stay unchanged.")
        print("Enter a Google app password (16 letters), not your normal Google password.")
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            password = getpass.getpass("Google app password (hidden): ").replace(" ", "")
        if not re.fullmatch(r"[A-Za-z]{16}", password):
            print("The app password must contain exactly 16 letters. No configuration was changed.", file=sys.stderr)
            return 1
        print("Checking Gmail authentication privately; no email will be sent.")
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=10, context=ssl.create_default_context()) as smtp:
            smtp.login(SENDER, password)

        values = dict(zip(CONTACT_KEYS, ["smtp", "smtp.gmail.com", "465", SENDER, password, SENDER]))
        replacement = updated_env(original, values)
        if ENV_FILE.read_bytes() != original or inspect(APP)["Id"] != before["Id"]:
            raise RuntimeError("Deployment changed during setup")
        if inspect(GATEWAY)["Id"] != gateway["Id"]:
            raise RuntimeError("Gateway changed during setup")
        backup = Path(tempfile.mkdtemp(prefix=".contact-gmail-backup-", dir=ENV_FILE.parent)) / ".env.before"
        with backup.open("xb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(original)
            stream.flush()
            os.fsync(stream.fileno())
        changed = True
        atomic_env(replacement)
        run(COMPOSE + ["config", "--quiet"])
        run(COMPOSE + ["up", "-d", "--no-deps", "--no-build", "app"])
        after = healthy()
        verify_preserved(before, after, gateway["Id"])
        if any(environment(after).get(key) != value for key, value in values.items()):
            raise RuntimeError("Contact configuration was not applied")
        verify_account_access(access_before)
        if json.loads(http_check("/api/contact", 200)).get("available") is not True:
            raise RuntimeError("Contact delivery remains unavailable")
        print(f"Contact email is ready. The application is healthy and account access remains {access_before}.")
        print("Open https://taxiai.app/contact and send your own test through the form.")
        print(f"Previous configuration is stored privately at {backup}.")
        return 0
    except BaseException:
        # Never print SMTP/provider errors, command output, credentials, or a traceback.
        if not changed:
            print("Setup did not complete. No configuration was changed. Check the app password and server prerequisites privately.", file=sys.stderr)
            return 1
        print("Setup verification failed. Restoring the previous configuration.", file=sys.stderr)
        try:
            atomic_env(original)
            run(COMPOSE + ["config", "--quiet"])
            run(COMPOSE + ["up", "-d", "--no-deps", "--no-build", "--force-recreate", "app"])
            restored = healthy()
            verify_preserved(before, restored, gateway["Id"])
            if sorted(before["Config"]["Env"]) != sorted(restored["Config"]["Env"]):
                raise RuntimeError("Previous environment was not restored")
            verify_account_access(access_before)
            print("Previous configuration restored; the application is healthy. Contact setup is incomplete.", file=sys.stderr)
        except BaseException:
            print(f"Automatic recovery could not be verified. The private backup is {backup}. Check the server directly; do not share its contents.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
