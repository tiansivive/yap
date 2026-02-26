# Yap — AI Agent Instructions

Yap is a dependently typed language with structural types, implicits, and verification semantics. This file guides AI coding agents working on the codebase.

**For full context**, read `.github/copilot-instructions.md` at session start. It covers architecture, coding guidelines, testing patterns, V2 migration, and agent interaction style.

## Project overview

- **Parser**: Nearley (legacy) + tree-sitter (v2 migration in progress)
- **Elaboration**: Bidirectional inference, NbE, constraint solving via unification
- **Verification**: Liquid refinements, SMT translation, Z3
- **Stack**: TypeScript (strict), pnpm, Vitest

Architecture docs: `docs/ARCHITECTURE.md`, `src/elaboration/ARCHITECTURE.md`, `docs/V2-MIGRATION.md`

## Dev environment tips

- Use `pnpm` for all commands (Node ≥ 18.3)
- Install z3: `brew install z3` (macOS)
- Path aliases: `@yap/elaboration/*`, `@yap/src/*`, `@yap/shared/*` (see `tsconfig.json`)
- After editing `src/parser/grammar.ne`, run `pnpm nearley` to regenerate the parser
- Regenerate tree-sitter types: `pnpm ts-dts` (after grammar changes in tree-sitter-yap)

## Build and run

```bash
pnpm install
pnpm nearley           # Regenerate parser (if grammar changed)
pnpm yap < file > .yap # Parse, elaborate, verify a source file
pnpm yap repl          # Interactive REPL
```

Do not use `pnpm build` while debugging; run `pnpm yap` directly.

## Testing instructions

- Run tests: `pnpm test`
- Update snapshots: `pnpm test -u`
- Specific test: `pnpm test <path/to/test/file>`
- Before committing: `pnpm lint` and `pnpm test`
- **Parser tests**: Use `ParserStart = "Ann"`; assert `data.results.length === 1`; snapshot `data.results[0]`
- **Elaboration tests**: Use `elaborateFrom(src)` from `util.ts`; reset supplies for determinism; assert on `structure` first, then snapshots
- Add or update tests for code you change

## Coding conventions

- Prefer immutable code, V2 Do notation, `ts-pattern` match over if/else
- One-word names; small functions; KISS/DRY
- Prefer recursion over imperative loops
- Comments explain "why", not "what"
- V2 elaboration: `src/elaboration/inference.v2/`, `src/elaboration/checking.v2/`; v1 is deprecated

## PR instructions

- Title format: `[<area>] <Description>`
- Run `pnpm lint` and `pnpm test` before committing
- Ensure tests pass and snapshots are updated if behavior changed

## Key references

| Topic                        | Location                          |
| ---------------------------- | --------------------------------- |
| Full agent instructions      | `.github/copilot-instructions.md` |
| Architecture                 | `docs/ARCHITECTURE.md`            |
| V2 migration status          | `docs/V2-MIGRATION.md`            |
| MIR design and lowering plan | `docs/MIR-LOWERING.md`            |
| Design specs, roadmap        | `brainstorming/yap/`              |
