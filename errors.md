# TypeScript / quality policy

**Typecheck is clean and stays at zero.** There is no error baseline to chip away at — any error is
a regression introduced by the current change.

## The real checks

```bash
npm run typecheck        # tsc --noEmit -p tsconfig.app.json      (renderer / src)
npm run typecheck:electron   # tsc --noEmit -p electron/tsconfig.json  (main process)
npm run typecheck:all    # both of the above
tsc --noEmit -p tsconfig.node.json   # vite.config.ts
```

Run all three before committing. `tsconfig.app.json` is the renderer source of truth; a bare
`tsc --noEmit` (no `-p`) checks the wrong project and lies — always pass `-p`.

## Rules

- Prefer truthful types / root-cause fixes over `as any`. The one sanctioned loose spot is the
  i18n shim: `t` is `Record<string,string>`, and lifted components use `(t as any).key || 'fallback'`
  — that is intentional so ported components compile without the full locale typing.
- `strict` is on. `noUnusedLocals`/`noUnusedParameters` are **off** for `src` (on for the node
  config) to keep lifted code low-friction; don't rely on that to leave dead code around.
- Both Vite builds must also succeed (`BUILD_TARGET=electron` and `=capacitor`) — the esbuild
  Electron bundle catches cross-tree import problems that `tsc` alone can miss (e.g.
  `electron/ipc/scan.ts` importing the pure `src/scan/scanProviders`).
- CI is not set up yet. Until it is, the pre-commit gate is manual: `typecheck:all` + both builds.
