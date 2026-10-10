# Merge origin/main into revamp/1-tooling

Conflicts:
- package.json: scripts block. Took branch's vitest-based scripts (lint/format/test/test:*), dropped main's old `node scripts/test-*.cjs` lines, and kept a single `test:migrations` = `npm test -- migrations` (main's trailing cjs `test:migrations` duplicate removed). Main's audit-fix dependency bumps auto-merged.
- src/main/database/index.ts: only a comment hunk around initDatabaseAt; kept main's comment. initDatabase one-liner + initDatabaseAt split retained; main's migration reordering auto-merged into the body.

Main's test (scripts/test-migrations.cjs) ported to src/main/test/migrations.test.ts (initDatabaseAt(':memory:'), 5 tests, runs under main project glob); cjs script deleted.

Commands: git fetch/merge; npm install; npx @electron/rebuild -f -w better-sqlite3; npm run typecheck (0 errors); npm run lint (exit 0, 0 errors, warnings only); npm test (13 files, 83 tests pass).
Migration stderr "[migrations] non-idempotent error" lines: GONE (and asserted by the new test).
