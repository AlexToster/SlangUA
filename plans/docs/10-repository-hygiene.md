# Repository Hygiene Follow-up

**Status:** the two items this document was opened for are closed. Kept as the record of what was done and why, so the decisions are not re-litigated.

## Resolved

- **`node_modules/` is no longer tracked.** ~8,788 paths inherited from early commits were removed from the index in an isolated commit (`git rm`-equivalent via `git update-index --force-remove`; the local installation was untouched). It was already in `.gitignore`, so nothing re-adds it. This is what made `git status` at the repository root time out past 120 s.
- **`.env` is out of the current history.** History was rewritten by the owner; `main` and `origin/main` no longer contain the file. What remains locally are `refs/original/*` backup refs left behind by `git filter-branch` — they are local-only and can be dropped with `git update-ref -d` plus `git reflog expire --expire=now --all && git gc --prune=now` whenever the owner wants the objects gone.
- **Credential rotation: deliberately declined by the repository owner.** The repository was private for its whole life, and when the committed `.env` was noticed the GitHub repository was deleted and recreated under the same name. The exposure window was therefore limited to the owner's own account. This is a closed decision — do not re-raise it.
- **Root `dist/` and `frontend/dist/` are ignored** and are not tracked.
- **Deployment scripts live outside the repository** because they carry production server details. `deploy/*.ps1` and `deploy/*.sh` are ignored in both `.gitignore` and `.dockerignore`; only `deploy/nginx/` is versioned, parameterised with `__SERVER_NAME__`. Do not recreate them here.

## Remaining

1. Regenerate `package-lock.json` — it was not refreshed after the `@fastify/cookie` and `jsonwebtoken` removals. Run `npm install` on the development machine (a Linux run would resolve different optional native packages).
2. Verify a fresh clone: `npm ci` and `npm ci --prefix frontend`, then the backend and frontend check suites. This is the real proof that untracking `node_modules` cost nothing.
