# Repository Hygiene Follow-up

## Current audit

- Root `dist/` and `frontend/dist/` are ignored and are not tracked by Git.
- `.env` is still tracked in the current repository history. Its secrets must be treated as exposed and rotated before any history cleanup is considered.
- `node_modules/` is ignored for new files but approximately 8,788 paths remain tracked from earlier commits. This inflates repository size and can make dependency updates noisy.

## Separately reviewable cleanup plan

1. Rotate every credential that has ever appeared in `.env` (database, Redis, JWT, refresh HMAC, preview root key, Telegram, and AI providers). Confirm deployed environments use the replacements.
2. In a dedicated branch, remove only `node_modules/` from the Git index while preserving the local installation, verify `package-lock.json` is the sole dependency lockfile, then commit that isolated change. Do not mix application changes into this commit.
3. Confirm a fresh clone followed by `npm ci` and `npm ci --prefix frontend` recreates the required dependencies; run backend and frontend checks.
4. Decide with repository owners whether secret-bearing `.env` history requires a history rewrite. If approved, perform it as a separately coordinated operation after rotation, force-push safeguards, and collaborator communication are in place.

No history rewrite, credential rotation, or dependency deletion is performed by this document.
