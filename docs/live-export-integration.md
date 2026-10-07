# Integration against the exported running Taxi Ai source

The operator export at `/home/ubuntu/taxi-ai-live-review-20261003` contains 464 hashed, allowlisted text files from running image `sha256:707fe64ac0268a032b7a9fb4b4dddfe714a1fa056aef75a92fc1c1f4aa6d3503`. The image has no source-revision label. Its inventory reports SQLite schema 47, public account access, community maps, disabled account/contact SMTP and phone push, no administrator or active Owner, and no active trips or legacy parcel grants at inspection time. Those counts are a snapshot, not a permanent cutover guarantee.

The separate integration worktree starts from prepared tracking commit `9d5ad90` and retains the exported differences from source baseline `88fce65`:

- The shared web/native per-address registration limit is retained in both HTTP routers.
- Public/invited access-mode validation, gateway access handling, and access-mode diagnostics remain as exported.
- The live PostgreSQL snapshot-import sequence repair remains unchanged.
- Exported PostgreSQL migration `021_snapshot_import_constraints.sql` is retained unchanged. The not-yet-deployed tracking migration is renumbered to `022_parcel_hardening.sql`, registered after it. The upgrade fixture now covers both prior versions 20 and 21.
- The applicable running-database migration remains SQLite 47 to 48. No production PostgreSQL cutover is implied by PostgreSQL test results.

All 464 exported text-file hashes were checked before reconciliation. Three files required reconciliation and five other exported differences were preserved. Runtime text reconciliation is not verification of binary assets, build instructions, mounts, environment values or the complete image.

Validation on this integration worktree: 18 focused SQLite/backend checks passed, covering journey, recipient binding, snapshots and hosted access. Two additional tests passed for preserving public account access, rejecting anonymous staff access and sharing the registration cap across web/native. Architecture checks passed across 580 JavaScript modules. No production database, account or service was changed.

The complete regression suite, the revised PostgreSQL migration sequence, signed phone builds, real email delivery and physical-device tracking have not been revalidated on this integrated candidate. Recheck runtime identity and active-work counts before any actual deployment, and take a verified backup. Do not replace production with the entire development snapshot.

Admin access: the existing deployed login is `https://taxiai.app/admin`, but the exported live database contains zero administrator accounts. The exported bootstrap command requires a separate password-based customer account with no Google link, driver capability or ride history. An authorized operator can invoke the deployed command inside the existing app container for the explicitly chosen account. Do not run bootstrap from this integration worktree against a default local database, and do not invent an administrator email or password.

Email, staff MFA, provider capacity and phone build credentials remain operator-controlled deployment prerequisites. The export only made read-only runtime source and aggregate state available to review; it did not grant remote Docker or privileged production access.
