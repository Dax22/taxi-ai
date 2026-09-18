# Working on Taxi Ai

## Open and run the existing project

Open your existing `taxi-ai` folder in VS Code. Do not clone or initialize another
repository just to receive an update. Use Node 22.12+; Node 24 is selected by
`.nvmrc` for new setups.

```bash
npm run verify
npm run dev
```

The code has no third-party dependencies to install. Administrator/email setup
can wait while you work on the code and homepage demo. Driver approval testing
requires the separate local administrator setup in [README.md](README.md).

## Get the modular architecture branch

First check your current branch and changes:

```bash
git status
git fetch origin
```

If you have local edits, review and commit them on your current branch before
switching. Do not discard them to make a checkout succeed. With a clean working
tree, run:

```bash
git switch refactor/modular-architecture
git pull --ff-only origin refactor/modular-architecture
npm run verify
```

Git normally creates a tracking branch when the name exists only on `origin`.
If the switch reports an ambiguous branch name, explicitly use
`git switch --track origin/refactor/modular-architecture` for the first checkout.

## Save your own changes to GitHub

Saving a file changes your local copy. A commit records it locally. A push sends
the commits to GitHub. Files do not upload automatically on every editor save.

1. Start a named feature branch from the agreed development base. Until the
   existing milestone pull requests are merged, that base is the latest feature
   branch, rather than the still-minimal `main` branch.
2. Make the change and run `npm run verify`.
3. In VS Code, open **Source Control**, review each diff, and click **+** beside
   the files you intend to include. Enter a descriptive message and **Commit**.
4. For a new branch, choose **Publish Branch**. For an existing remote branch,
   choose **Push**. **Sync Changes** also pulls remote commits before pushing;
   review and resolve any reported conflicts.
5. Open a pull request into the agreed base branch. Explain the problem, resulting
   behaviour and verification. Review and merge it separately from pushing.

Equivalent terminal commands after reviewing changes:

```bash
git status
git diff
npm run verify
git add -p
git diff --cached
git commit -m "Describe the completed change"
git push -u origin HEAD
```

`git add -p` stages changes to tracked files. Stage new files by their explicit
paths or with VS Code's **+** buttons. Never force-push a shared branch. If commit
identity is missing, configure your name and an email associated with your GitHub
account, including its private noreply address if preferred. This does not require
a Taxi Ai business mailbox.

Existing milestones are stacked: project foundation → web booking demo → accounts
and rides → modular architecture. Each pull request reviews only its next layer.
Pushing keeps the code on GitHub; it does not merge the stack into `main`. Review
the dependencies before merging or retargeting their pull requests.

## Where to put a change

Read [the architecture](docs/architecture.md) and its
[decision record](docs/decisions/0001-modular-monolith.md) first.

| Change | Location |
| --- | --- |
| Pure fare/money rules | `packages/shared/src/` |
| Account, driver or ride use case | Its `services/api/src/modules/<feature>/service.mjs` |
| Feature SQL | Its `repository.mjs` |
| Route mapping | Its `routes.mjs` |
| HTTP parsing/cookies/error translation | `services/api/src/http/` |
| Database/password/token/audit adapters | `services/api/src/infrastructure/` |
| Dependency wiring | `services/api/src/application.mjs` |
| Dashboard presentation | `apps/web/public/dashboard/views.mjs` |
| Dashboard transport/retry policy | `apps/web/public/dashboard/api-client.mjs` |

Use named exports and static ESM imports. Inject clock, storage and cross-module
operations; keep SQL and HTTP objects out of services. Use synchronous callbacks
inside the current SQLite unit of work. Place asynchronous password/provider work
outside database transactions. Do not call a payment or messaging provider from
inside a transaction; a later integration needs an explicit delivery/retry design.

Validate inputs at the trust boundary and recheck mutable permissions/state inside
the write transaction. Derive actor IDs from the session. Use integer kobo for
money. Preserve offer ID, version, expiry, opposite-person acceptance and retry
semantics. Never infer an agreement from suggested prices or chat/call content.

For a new feature, create its module only when implementing a real use case.
Wire its ports in the composition root, add its route factory to the router and
test its meaningful permissions, state changes and failure paths. Avoid importing
another module's internals or introducing generic abstractions without a use.

## Verification and data

`npm run check` checks JavaScript syntax and our static module conventions.
`npm test` covers domain, browser API client, HTTP, persistence and architecture
behaviour. `npm run verify` runs both. The GitHub workflow runs the same command
on Node 22.12.0 and Node 24 for pushes and pull requests. Hosted Actions must be
enabled for the repository; passing local checks is not a claim that CI ran.

Browser layout and interaction review is separate; follow
[the manual review guide](apps/web/README.md#manual-browser-review).

The ignored `data/` directory contains local accounts and ride history. Never
commit database files, passwords, API keys or environment secrets. Test fixtures
use memory databases or disposable temporary files. Changes to deployed schemas
need a forward migration and compatibility tests; do not rewrite an already-used
migration to reset user data.
