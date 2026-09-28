# Deployment control

Taxi AI now treats GitHub as the source of truth for build artifacts.

## Verified container publishing

Updates merged into `integration/resolved-vscode-slider` trigger
`.github/workflows/publish-container.yml`.

The workflow:

1. checks out the exact merged commit;
2. builds the root Dockerfile;
3. runs `scripts/container-smoke.mjs` against that exact image;
4. publishes the verified image to GitHub Container Registry with:
   - an immutable commit-SHA tag; and
   - the moving `integration` tag.

Promotions should use the immutable SHA tag so a deployment can always be tied
back to one Git commit.

The image name is:

```text
ghcr.io/dax22/taxi-ai
```

## Deploying the published image

The existing invited-staging stack remains the runtime definition. Add the
registry override so the host pulls the CI-built application image rather than
building source locally:

```bash
export TAXI_AI_IMAGE=ghcr.io/dax22/taxi-ai:<commit-sha>

docker compose \
  --env-file deploy/staging/.env \
  -f deploy/staging/compose.yml \
  -f deploy/staging/compose.registry.yml \
  pull

docker compose \
  --env-file deploy/staging/.env \
  -f deploy/staging/compose.yml \
  -f deploy/staging/compose.registry.yml \
  up -d --no-build
```

Keep `deploy/staging/.env`, tester credentials, SSH keys, cloud credentials,
database passwords, OAuth secrets and provider tokens outside Git. Do not commit
them to this public repository.

If the GHCR package is not public, authenticate the deployment host to
`ghcr.io` with a read-only package credential before `docker compose pull`.

## Control boundary

GitHub can build, test and publish Taxi AI without Docker Desktop on a developer
Mac. A hosting account still needs to be connected or configured once before a
remote deployment can be performed. Runtime secrets belong in the hosting
platform or GitHub environment secrets, not in repository files.
