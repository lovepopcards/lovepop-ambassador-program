#!/usr/bin/env python3
"""Create the /ambassador/* SSM parameters that infra/prod.yaml's secrets_variables point at.

Never prints a value — only names, lengths and checks. Safe to re-run.

    python3 infra/scripts/put_ssm_params.py --env-file PATH [--dry-run]

--env-file  a dotenv file holding AMBASSADOR_AWS_DATABASE_URL (written by data-ml-mono's
            db_migration init-db) and, optionally, AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY /
            AWS_SESSION_TOKEN (e.g. a DataEngineer SSO session); otherwise the aws CLI's own credentials.

| Parameter | Source |
|---|---|
| database_url | AMBASSADOR_AWS_DATABASE_URL from --env-file (role ambassador on the data-team RDS cluster) |
| sso_ticket_secret | copied from /cdp/sso_ticket_secret, and only if it equals conan-edogawa's live /prod/central-login/sso_ticket_secret (or, if that is unreadable, a second app copy) — never from a file |
| team_session_secret | generated once; kept on re-run (--rotate-session-secrets replaces both, signing everyone out) |
| influencer_session_secret | generated once; kept on re-run |

Nothing comes from Railway: Railway was breached, and the old JWT default secret is in git.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
from pathlib import Path

REGION = "us-west-2"
PREFIX = "/ambassador"
PROD_YAML = Path(__file__).resolve().parent.parent / "prod.yaml"
AWS_KEYS = ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN")
DATABASE_URL_VAR = "AMBASSADOR_AWS_DATABASE_URL"
SESSION_SECRETS = ("team_session_secret", "influencer_session_secret")

TICKET_SOURCE = "/cdp/sso_ticket_secret"
TICKET_CENTRAL = "/prod/central-login/sso_ticket_secret"
TICKET_SECOND_COPY = "/b2b_metrics_email/sso_ticket_secret"


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        key, sep, value = line.strip().removeprefix("export ").partition("=")
        if sep and key.strip() and not key.startswith("#"):
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def aws_environment(file_values: dict[str, str]) -> dict[str, str]:
    env = dict(os.environ)
    env.update({key: file_values[key] for key in AWS_KEYS if file_values.get(key)})
    env.setdefault("AWS_REGION", REGION)
    return env


def aws(env: dict[str, str], *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["aws", *args, "--region", REGION, "--output", "json"], env=env, capture_output=True, text=True)


def get_value(env: dict[str, str], name: str) -> str | None:
    result = aws(env, "ssm", "get-parameter", "--with-decryption", "--name", name)
    if result.returncode != 0:
        return None
    return json.loads(result.stdout)["Parameter"]["Value"]


def exists(env: dict[str, str], name: str) -> bool:
    # describe-parameters, not get-parameter: the DataEngineer role cannot read *database* names.
    result = aws(env, "ssm", "describe-parameters", "--parameter-filters", f"Key=Name,Option=Equals,Values={name}")
    return result.returncode == 0 and bool(json.loads(result.stdout)["Parameters"])


def put_value(env: dict[str, str], name: str, value: str, dry_run: bool) -> None:
    if not value:
        sys.exit(f"✗ {name}: empty value")
    if dry_run:
        print(f"· would set {name} ({len(value)} chars)")
        return
    # A private temp file, not an argument: an argument would put the value in `ps`.
    fd, path = tempfile.mkstemp()
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump({"Name": name, "Value": value, "Type": "SecureString", "Overwrite": True, "Tier": "Standard"}, handle)
        result = aws(env, "ssm", "put-parameter", "--cli-input-json", f"file://{path}")
    finally:
        os.unlink(path)
    if result.returncode != 0:
        sys.exit(f"✗ {name}: put-parameter failed: {result.stderr.strip()}")
    print(f"✓ {name} ({len(value)} chars)")


def verified_ticket_secret(env: dict[str, str]) -> str:
    source = get_value(env, TICKET_SOURCE)
    if not source:
        sys.exit(f"✗ cannot read {TICKET_SOURCE}")
    central = get_value(env, TICKET_CENTRAL)
    if central is not None:
        if central != source:
            sys.exit(f"✗ {TICKET_SOURCE} differs from {TICKET_CENTRAL} — not copying a stale ticket secret")
        print(f"= {TICKET_SOURCE} equals {TICKET_CENTRAL}")
        return source
    second = get_value(env, TICKET_SECOND_COPY)
    if second != source:
        sys.exit(f"✗ {TICKET_CENTRAL} unreadable and {TICKET_SOURCE} ≠ {TICKET_SECOND_COPY} — stopping")
    print(f"= {TICKET_CENTRAL} unreadable with this role; {TICKET_SOURCE} equals {TICKET_SECOND_COPY}")
    return source


def check_prod_yaml(env: dict[str, str]) -> None:
    names = re.findall(r'value_from:\s*"([^"]+)"', PROD_YAML.read_text())
    result = aws(env, "ssm", "describe-parameters", "--parameter-filters", f"Key=Name,Option=BeginsWith,Values={PREFIX}/")
    existing = {p["Name"] for p in json.loads(result.stdout)["Parameters"]} if result.returncode == 0 else set()
    for name in names:
        print(f"  {'ok     ' if name in existing else 'MISSING'} {name}")
    if any(name not in existing for name in names):
        sys.exit("✗ the ECS task will not start until every value_from exists")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--rotate-session-secrets", action="store_true")
    args = parser.parse_args()
    file_values = read_env_file(args.env_file)
    env = aws_environment(file_values)

    identity = aws(env, "sts", "get-caller-identity")
    if identity.returncode != 0:
        sys.exit(f"✗ no AWS session: {identity.stderr.strip()}")
    print("AWS:", json.loads(identity.stdout)["Arn"])

    database_url = file_values.get(DATABASE_URL_VAR, "")
    if not re.search(r"/ambassador(\?|$)", database_url):
        sys.exit(f"✗ {DATABASE_URL_VAR} missing from {args.env_file} or not the ambassador database")
    put_value(env, f"{PREFIX}/database_url", database_url, args.dry_run)

    ticket = verified_ticket_secret(env)
    if get_value(env, f"{PREFIX}/sso_ticket_secret") == ticket:
        print(f"= {PREFIX}/sso_ticket_secret already current — kept")
    else:
        put_value(env, f"{PREFIX}/sso_ticket_secret", ticket, args.dry_run)

    for name in SESSION_SECRETS:
        if args.rotate_session_secrets or not exists(env, f"{PREFIX}/{name}"):
            put_value(env, f"{PREFIX}/{name}", secrets.token_hex(32), args.dry_run)
        else:
            print(f"= {PREFIX}/{name} exists — kept")

    if not args.dry_run:
        print("Checking prod.yaml secrets_variables…")
        check_prod_yaml(env)


if __name__ == "__main__":
    main()
