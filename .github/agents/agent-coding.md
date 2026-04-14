# Agent Configuration — ZenTabs Manager

This file defines the **development workflow** that GitHub Copilot (and any other AI coding agent) must follow when working on this project.

---

## Mandatory Workflow

### 1. Spec First — Always

Before writing any implementation code for a new feature, module, or significant change:

1. **Write a specification file** in the `specs/` directory (e.g., `specs/FeatureName.spec.md`).
2. The spec must cover:
   - Feature name and purpose
   - New class/module name and file location
   - Public API (method signatures + descriptions)
   - Data structures
   - Behaviour rules (bullet list, unambiguous)
   - Integration points (how it connects to existing code)
   - Explicitly out-of-scope items
   - Test file location and required test cases
3. **Ask the user to review the spec** before writing any code. Do not proceed to implementation until explicit approval is given.

### 2. Reference Specs

After a spec is approved and the feature is implemented:

- Add a reference to the spec file in the **Specifications** section of `.github/copilot-instructions.md`.
- Keep the spec file in `specs/` permanently — it is the authoritative design record.

### 3. Tests — Mandatory

Every implementation must include unit tests. See the **Testing Requirements** section in `.github/copilot-instructions.md` for the rules.

### 4. Documentation

Update `.github/copilot-instructions.md` after every feature:
- Preferences table (new prefs)
- Public API section (new methods)
- Architecture section (new classes/modules)
- Event System table (new events)

### 5. Bump `updatedAt`

After each change session, update the `updatedAt` field in `theme.json` to the current UTC datetime.

---

## Tone and Style

- **Brief, direct answers** — no fluff, no lengthy preamble.
- **Implement rather than suggest** unless the user explicitly asks for options.
- **Never over-engineer** — only change what was asked for.
- **Do not add comments, docstrings, or type annotations** to code that was not changed.

---

## Project Context

This is a **Zen Browser mod** using the Sine mod loader. The full project context, API reference, and architecture are in `.github/copilot-instructions.md`. Always read that file before working on any feature.

Key constraints:
- No bundler, no npm dependencies, no TypeScript — plain `.mjs` ES modules only.
- Code runs in the Zen Browser privileged chrome context.
- `window` is the browser chrome window; XUL/XPCOM APIs are available.

---

## Specifications Index

All approved and implemented specifications live in `specs/`:

| Spec file | Feature | Status |
|---|---|---|
| `specs/SimpleBookmarkSync.spec.md` | One-way tab-to-bookmark sync (`SimpleBookmarkSyncManager`) | Implemented |
| `specs/SpaceMetadataSync.spec.md` | Space icon/theme metadata in bookmarks + rename detection | Implemented — 2026-04-14 |

