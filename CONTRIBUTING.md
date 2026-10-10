# Contributing

## Setup

```bash
npm ci
npm run prepare   # sets core.hooksPath=scripts/git-hooks
```

Git hooks: `core.hooksPath` must be relative (`scripts/git-hooks`) — run `npm run prepare` in every worktree; an absolute hooksPath makes worktrees run the main checkout's hooks.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite + Electron |
| `npm test` / `test:watch` | Vitest under `ELECTRON_RUN_AS_NODE=1 electron` |
| `npm run lint` | ESLint (hex / blocky-radius rules) |
| `npm run format` | Prettier |
| `npm run gen:channels` | Regenerate `src/shared/ipc-channels.ts` (`gen:channels:check` fails if stale) |
| `npm run typecheck` | `tsc --noEmit` (main + renderer) |
| `npm run build` | Build renderer + main |

## Adding an IPC channel

1. Define it in a domain file (`src/main/ipc/domains/`) with `defineHandler`, or a row in a feat table (`src/main/ipc/feat/`) used by `featHandlers`. Set `mutates: true` if it writes data.
2. Run `npm run gen:channels` (pre-commit does this too).
3. Add the wrapper in `src/renderer/lib/api.ts` — unknown channel names are compile errors.
4. Optionally add an `IpcContract` entry for typed args/results.

`src/main/ipc/index.ts` is bootstrap only; do not add handlers there.

## Tests

Colocate `*.test.ts` next to the code (`domains/x.test.ts`, `feat/x.test.ts`). Use the Electron mock and in-memory DB from `src/main/test/`.

## Hooks

pre-commit runs lint-staged and related tests; pre-push runs typecheck and tests. Emergency override: `SKIP_HOOKS=1 git commit ...`.
