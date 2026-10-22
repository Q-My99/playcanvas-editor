# Agent Guidelines for PlayCanvas Editor

## Project

- TypeScript frontend for the PlayCanvas web-based 3D editor
- Build: Vite | Styles: SASS | Lint: ESLint 9 + Stylelint 16 | Test: Mocha + Chai
- Bun 1.4.0 or newer (`package.json` / root `.bun-version`)
- Use Bun. In the parent monorepo, install once at its root with `bun install --frozen-lockfile`; standalone clones use their own `bun.lock`.
- Commands: `bun run build`, `bun run develop`, `bun run lint`, `bun run fmt`, `bun run test`, `bun run typecheck`
- Development server: `bun run develop`, serving generated frontend files on port 3487
- Do not commit or push unless the user explicitly requests it.

## Repository and Releases

- Public fork: `https://github.com/Q-My99/playcanvas-editor`
- Official upstream: `https://github.com/playcanvas/editor`
- Local remotes:
    - `origin` points to the `Q-My99/playcanvas-editor` fork
    - `upstream` points to the official `playcanvas/editor` repository
- `launch-engine-v1-77` is the primary business and release branch for future work.
- Distribution releases are created by `.github/workflows/distribution-release.yml`.
- Pushing `launch-engine-v1-77` alone does not publish a release.
- A release is published only when a tag matching `playcanvas-editor-v<editor-version>-r<revision>` is pushed, for example `playcanvas-editor-v2.28.1-r2`.
- Release assets include the complete `dist/` archive, `release.json`, `SHA256SUMS`, and the MIT license.
- Before creating a release tag, run the relevant tests and production build, verify the tag points at the intended commit, and increment the `rN` revision instead of replacing an existing release tag.

## How the Editor Loads

- A backend server renders an HTML shell via Mustache templates
- Injects `var config = {...}` (user, project, flags, URLs) into a `<script>` tag
- Frontend bundle loaded from a configurable base URL; `window.config` drives all runtime behavior
- Local development normally opens the hosted PlayCanvas shell with `?use_local_frontend`; the shell then loads frontend assets from `http://localhost:3487`
- Page variants:
    - **Editor** — `src/editor/index.ts` → `editor.js` (full editor)
    - **Blank** — `src/editor/blank.ts` → `editor-empty.js` (project/scene selection)
    - **Code Editor** — `src/code-editor/index.ts` → `code-editor.js` (Monaco)
    - **Launch** — `src/launch/index.ts` → `launch.js` (app preview)

## Architecture

- Class hierarchy: `Caller` → `Editor<T>` (`src/common/editor.ts`) → `MainEditor` (`src/editor/editor.ts`)
- **Caller pattern** — cross-module communication via `this.call('method:name', ...args)` / `this.method('method:name', handler)`
- **Side-effect imports** — `src/editor/index.ts` registers all modules on import; do not remove imports unless removing a feature
- **editor-api** — folded into `src/editor-api/`; the removed root `modules/editor-api/` directory is obsolete and ignored

## Engine Compatibility Work

- Frozen legacy snapshot: branch `engine-v1-lts`, commit `5741de270d59843aa36486b620b4068880325848`
    - Based on Editor `v2.12.5`
    - Forces both the Editor viewport and Launch runtime onto Engine `1.77.0`
    - This branch is no longer maintained
    - Keep this branch and commit intact as an archive; do not develop on, reset, rewrite, or delete them
- Primary business branch: `launch-engine-v1-77`
    - Based on official tag `v2.28.1`
    - `v2.28.1` is the last official release before `v2.29.0` migrated V1 projects and removed the V1 picker
    - Compatibility commit: `7769abc0820076b588256650e252358075ec4959`
    - All future compatibility work and distribution releases should be based on this branch unless the user explicitly selects another branch
- Keep these three concepts separate:
    1. **Editor version** — currently `v2.28.1`
    2. **Editor viewport engine** — the bundled/default Engine 2, preserving Outline, Light Gizmo, Transform Gizmo, depth helpers, and asset thumbnails
    3. **Launch/runtime engine** — can be forced to Engine `1.77.0` independently of the Editor viewport
- Launch options on the current branch are independent:
    - `Force Engine v1.77.0` adds `version=1.77.0`
    - `Force WebGL 1.0` adds `device=webgl1`
    - Either option can be used alone or both can be enabled
    - `use_local_engine` does not implicitly force WebGL 1.0
- Known history relevant to tag selection:
    - `e632ce7a`: bundled engine change, first included in `v2.12.6`
    - `669db1cb`: surfaced `use_local_engine`, first included in `v2.23.3`
    - `e8fbd26f`: V1 auto-migration / picker removal, first included in `v2.29.0`
- Verified scene: `https://playcanvas.com/editor/scene/2558608?use_local_frontend`
- Verification must inspect the launched page's actual `pc.version`, loaded Engine script, and graphics device. A dropdown label or query string alone is not sufficient evidence.

## Conventions

- Path aliases: `@/*` → `./src/*`
- Naming: PascalCase classes, camelCase functions, UPPER_SNAKE_CASE constants, kebab-case files
- Strict TypeScript — all public APIs must have proper type annotations
- Only fix lint issues in code you are modifying
- Styles live in `sass/`, compiled via `compile-sass.mjs`
- Heavy work (texture convert, search, console) goes in Web Workers (`src/workers/`)

## Things to Avoid

- Don't edit `dist/` — generated output
- Don't remove side-effect imports from `index.ts` without understanding consequences
- Don't bypass the Caller pattern for cross-module communication
- Don't add heavy synchronous work to the main thread — use Web Workers
- Don't introduce circular dependencies
- Don't hardcode URLs or config values — use `window.config`. The explicit Engine `1.77.0` Launch override is a scoped compatibility exception.

## Current Validation Baseline

- `bun run build`: passes
- `bun run test`: 182 passing
- `bun run lint`: passes with 1273 existing warnings and no errors
- Full `bun run typecheck`: 1751 baseline diagnostics, unchanged after normalizing line numbers and the relocated Engine package path; distinguish those from new errors
- `.DS_Store`, root `/modules/`, `node_modules/`, and `dist/` are ignored

When in doubt, look at similar existing code or ask.
