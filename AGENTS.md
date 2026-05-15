# Yap — AI Agent Instructions

Yap is a dependently typed language with structural types, implicits, and verification semantics. This file guides AI coding agents working on the codebase.

**For full context**, read `.github/copilot-instructions.md` at session start. It covers architecture, detailed guidelines, testing patterns, V2 migration, and agent interaction style.

**Session start (recommended):** At the start of a new chat, @-mention these files so the agent has them in context:

```
@AGENTS.md @.github/copilot-instructions.md @.cursor/rules/coding-style.mdc @.cursor/rules/pattern-matching.mdc
```

Then ask the agent to read and apply them for the session. This ensures the guidelines are always followed.

**Cursor rules** (`.cursor/rules/`) encode style and conventions; they apply automatically when editing matching files:

| Rule                   | Applies                        | Content                                                   |
| ---------------------- | ------------------------------ | --------------------------------------------------------- |
| `session-start.mdc`    | always                         | Read guidelines at session start; apply from the start    |
| `agent-behavior.mdc`   | always                         | Collaborative, validate, surface issues, self-maintenance |
| `coding-style.mdc`     | always                         | Immutable, terse, V2 Do, recursion, map/reduce            |
| `pattern-matching.mdc` | always                         | ts-pattern with const pattern objects; no if checks       |
| `conventions.mdc`      | always                         | Path aliases, pitfalls, tree-sitter, v2                   |
| `testing.mdc`          | `**/__tests__/**`, `*.test.ts` | Parser, elaboration, module test patterns                 |

## Project overview

- **Parser**: Nearley (legacy) + tree-sitter (v2 migration in progress)
- **Elaboration**: Bidirectional inference, NbE, constraint solving via unification
- **Verification**: Liquid refinements, SMT translation, Z3
- **Stack**: TypeScript (strict), pnpm, Vitest

Architecture: `docs/ARCHITECTURE.md`, `src/elaboration/ARCHITECTURE.md`, `brainstorming/yap/V2-MIGRATION.md`

## Dev environment

- Use `pnpm` for all commands (Node ≥ 18.3)
- Install z3: `brew install z3` (macOS)
- Path aliases: `@yap/elaboration/*`, `@yap/src/*`, `@yap/shared/*` (see `tsconfig.json`)
- After editing `src/parser/grammar.ne` → `pnpm nearley`
- After grammar changes in tree-sitter-yap → `pnpm ts-dts`

## Build and run

```bash
pnpm install
pnpm nearley           # Regenerate parser (if grammar changed)
pnpm yap < file > .yap # Parse, elaborate, verify
pnpm yap repl          # Interactive REPL
```

Do not use `pnpm build` while debugging; run `pnpm yap` directly.

## Testing

- Run: `pnpm test` | Update snapshots: `pnpm test -u` | Specific: `pnpm test <path>`
- Before committing: `pnpm lint` and `pnpm test`
- **Parser**: `ParserStart = "Ann"`; assert `data.results.length === 1`; snapshot `data.results[0]`
- **Elaboration**: `elaborateFrom(src)` from `util.ts`; reset supplies; assert on `structure` first, then snapshots
- Add or update tests for code you change

## Style guide (summary)

- **Immutable**, declarative, recursion over loops
- **Namespace-based APIs** — `Category.action` over `actionCategory`
- **V2 Do notation**; avoid long fp-ts pipelines
- **ts-pattern** with const pattern objects (no if checks, no predicate helpers)
- **One-word names**; small functions; KISS/DRY
- **Comments explain "why"**, not "what"
- **V2 elaboration** in `inference.v2/`, `checking.v2/`; v1 deprecated

## PR instructions

- Title: `[<area>] <Description>`
- Run `pnpm lint` and `pnpm test` before committing
- Ensure tests pass and snapshots are updated if behavior changed

## Key references

| Topic                   | Location                            |
| ----------------------- | ----------------------------------- |
| Full agent instructions | `.github/copilot-instructions.md`   |
| Architecture            | `docs/ARCHITECTURE.md`              |
| V2 migration            | `brainstorming/yap/V2-MIGRATION.md` |
| MIR / lowering          | `docs/MIR-LOWERING.md`              |
| Design specs, roadmap   | `brainstorming/yap/`                |
| Cursor rules            | `.cursor/rules/*.mdc`               |

Lowering (`src/lowering/`): Lit, Var, prim App, Struct/Proj/Inj, Lambda (closure conversion), App (indirect), Match, Block, Reset/Shift. Shift/reset in `delimited_continuation/` (Alloc + Read + Jump, multishot: Branch + resume blocks). Returns `Module`. See MIR-LOWERING.md §5, §7.6.

## Cursor Cloud specific instructions

This is a single-package TypeScript compiler/language toolchain with no external services (no databases, containers, or network dependencies). Z3 is bundled as WASM via the `z3-solver` npm package — no system binary needed.

### Node.js version

The project requires Node.js **23.11.1** (see `.nvmrc`). In the cloud VM, nvm is available and the correct version is pre-installed. Use `nvm use 23.11.1` if you need to switch.

### Setup after dependency install

After `pnpm install`, always run `pnpm nearley` to regenerate the parser before running tests or the compiler. The parser source is `src/parser/grammar.ne` and the generated output is `src/parser/grammar.ts`.

### ESLint config

The ESLint flat config uses ESM syntax (`import`/`export` and `import.meta.dirname`), but the package is `"type": "commonjs"`. The config file must use the `.mjs` extension (`eslint.config.mjs`) for ESLint to load it correctly. If you encounter `SyntaxError: Cannot use import statement outside a module` when running `pnpm lint`, verify the config filename is `eslint.config.mjs`, not `.js`.

### pnpm build scripts

The `pnpm-workspace.yaml` must have `allowBuilds: esbuild: true` for esbuild postinstall scripts to run. Without this, `pnpm install` will fail (exit code 1) with `ERR_PNPM_IGNORED_BUILDS`.

### Running the compiler

Use `pnpm yap <filepath> --srcDir .` from the workspace root. Without `--srcDir .`, the compiler defaults to a `yap/` subdirectory as the base URL, causing file-not-found errors.

### Tests

Run `pnpm test --run` for a single pass. Test snapshots may contain absolute paths (e.g. in codegen output); if you see snapshot mismatches on first run, update with `pnpm test --run -u`. The `generalization.test.ts` file has 16 pre-existing failures (`TypeError: Cannot read properties of undefined`) that are bugs in the source code, not environment issues.

### Key commands reference

See `package.json` scripts and the "Dev environment" / "Build and run" / "Testing" sections above for standard commands (`pnpm install`, `pnpm nearley`, `pnpm test`, `pnpm lint`, `pnpm yap`).
