# Copilot Instructions for this Repo

This repo implements Yap, a small dependently typed language with structural types, implicits and code verification semantics via modalities (currently QTT-based multiplicities and Liquid type refinements)
It contains a Nearley-based parser and an elaboration/inference pipeline which uses NbE and emits contraints subsequently solved via first order Unification.

## Architecture

Design authority lives in `z-yap/` plus source paths. At session start, read `z-yap/init.md` and use the ZK scripts there to find the relevant thread or zettel.

Core entry points:

- Project hub: `z-yap/zettels/yap.md`
- Parser migration: `z-yap/zettels/parser-migration.thread.md`
- Elaboration: `z-yap/zettels/elaboration-v2.thread.md`
- Normalization/NbE: `z-yap/zettels/nbe.md`
- Verification: `z-yap/zettels/verification-backend.thread.md`, `z-yap/zettels/verification-pipeline.md`
- GRAM/MIR/codegen: `z-yap/zettels/gram-evolution.thread.md`, `z-yap/zettels/gram-canonical-ir.adr.md`

Migration tracking: `brainstorming/yap/V2-MIGRATION.md`

## How to build and test

We use `pnpm` and `vitest`.

`package.json` scripts:

```json
  "build": "tsup",
  "format": "prettier .",
  "lint": "eslint . --max-warnings 0",
  "lint:knip": "knip",
  "nearley": "nearleyc src/parser/grammar.ne -o src/parser/grammar.ts && echo '// @ts-nocheck' | cat - src/parser/grammar.ts > temp && mv temp src/parser/grammar.ts",
  "parse": "tsc src/parser/grammar.ts --skipLibCheck --noEmitOnError --allowJs && nearley-test bin/grammar.js",
  "prepare": "husky",
  "railroad": "nearley-railroad src/parser/grammar.ne -o gen/parser/grammar.html",
  "release": "release-it",
  "test": "vitest",
  "tsc": "tsc -p ./tsc.tsconfig.json",
  "typecheck": "tsc --noEmit -p ./tsc.tsconfig.json",
  "yap": "TS_NODE_TRANSPILE_ONLY=true node --stack-size=131072 --require ts-node/register ./scripts/cli.ts"
```

We should NOT use `build` while debugging.
Simply run `pnpm yap <file>.yap` to parse, elaborate and verify a yap source file.
Passing `repl` to `yap` will launch an interactive REPL.

If you edit the grammar, run `pnpm run nearley` to regenerate the parser.
Run `pnpm test` to run the tests. You can update snapshots with `pnpm test -u` and run specific tests with `pnpm test <path/to/test/file>`.

## Coding guidelines

> **Cursor users**: Style and conventions are also encoded in `.cursor/rules/*.mdc` (pattern-matching, coding-style, testing, conventions, agent-behavior). See `AGENTS.md` for the rule index.

### Patterns and abstraction

- Elaboration Monad (V2) (`src/elaboration/shared/monad.v2.ts`)
  - V1 is deprecated. Only kept for reference.
  - Uses generators to model Do Notation and allow imperative idiomatic code.
  - `V2.Do()` takes a generator function and iterates its `yields` with imperative based `ReaderWriterEither r w e` semantics.

### Style guidelines

- Prefer immutable code.
- Prefer simple, linear flow by virtue of V2 Do notation.
- Avoid long `fp-ts` function pipelines as they make debugging harder and more annoying.
- Prefer function composition/pipelines to interstitial variables that do not add semantic value.
- Prefer iterators and built-in higher order functions (map, filter, reduce, etc) over manual loops.
- Avoid wrapping in unecessary callbacks. e.g. `Array.map(doStuff)` instead of `Array.map(v => doStuff(v))`
- **Namespace-based APIs:** Prefer `Category.action` over `actionCategory`. Encode functionality in namespaces (objects with methods/fields), not in function names. Extensible and discoverable.
- Clean, Clear and Terse code:
  - One letter var names are fine in ML-like fashin. e.g. `Array.map(x =>...)` or `const [x, ...xs] = [1,2,3,4]`.
  - Try to keep function and variable names to only one word. Multi-word names typically indicate a function is doing too much, so refactoring is encouraged
  - Adhere to KISS and DRY. Small functions compose together.
  - Avoid bloated code.
  - Strive for minimalism but avoid cryptic cleveverness.
- Prefer declarative code over imperative when possible.
- Prefer `ts-pattern` `match` with guards over `if`/`else` chains and ternaries for multi-way dispatch.
  - Flatten all cases into separate `.with` clauses using guards (second argument) rather than nesting conditionals inside a handler.
  - Match on the discriminant directly (e.g. `node.type`, tuple of values) so ts-pattern can narrow types.
  - Use `.otherwise` for the fallthrough case.
  - **Do NOT use predicate helpers or if checks for structural dispatch:** Use `.with()` with **const pattern objects** (like `NF.Patterns`, `EB.CtorPatterns`, `src/lowering/patterns.ts` → `Patterns`). Create pattern objects with `as const` and reuse them.
- Prefer recursion over imperative looping.
- Avoid unneeded comments. Code should be self-documenting as much as possible.
  - Use types to document intent.
  - Comments should explain "why" something is done, not "what" is being done.
  - Brief and to the point comments are preferred.

## Dev workflows

- Install: `npm install` (Node >= 18.3).
- Generate parser after editing `grammar.ne`:
  - `npm run nearley` (compiles grammar.ne → grammar.ts; adds `// @ts-nocheck`).
- Build the library: `npm run build` (tsup to `lib/`, ESM output, source maps, `.lama` loader).
- Tests: `npm test` (Vitest). Path aliases are resolved by `vite-tsconfig-paths`.
  - Snapshots are used heavily; update with `npx vitest -u`.
  - Parser tests often set `ParserStart = "Ann"`.

## Testing patterns that matter here

### Parser tests (under `src/parser/__tests__`)

- Create a parser with `const g = { ...Grammar, ParserStart: "Ann" }; new Nearley.Parser(...)`.
- Always assert `data.results.length === 1`; then snapshot `data.results[0]`.
- Test different grammar entry points by changing `ParserStart` (e.g., `"Ann"`, `"Statement"`, `"Module"`).

### Elaboration tests (under `src/elaboration/inference/__tests__`)

- **Setup**: Use the `elaborateFrom(src)` helper from `util.ts` which:
  - Resets supplies for determinism: `EB.resetSupply("meta")` and `EB.resetSupply("var")`
  - Parses source string with `ParserStart = "Ann"`
  - Creates default context via `Lib.defaultContext()`
  - Runs `EB.infer(term)` inside V2 monad
  - Collects and returns `{ src, displays, structure }` where:
    - `displays`: pretty-printed term, type, and constraints
    - `structure`: raw AST nodes (term, type, constraints, metas, typedTerms)

- **Assertions**:
  - **Structural checks first**: Assert on `structure` properties (e.g., `expect(res.structure.term.type).toBe("Block")`)
  - **Snapshots for full output**: Use `expect({ displays: res.displays }).toMatchSnapshot()` and `expect({ structure: res.structure }).toMatchSnapshot()`
  - **Avoid string equality on pretty output**: Snapshots are preferred over exact string matches
  - **Check constraints**: `expect(res.displays.constraints).toHaveLength(...)` or check specific constraint patterns
  - **Check metas**: `Object.keys(res.structure.metas).length` to verify meta generation

- **Test organization**:
  - Group related tests with `describe()` blocks
  - Use descriptive test names that explain the scenario
  - Include both positive (success) and negative (expected failure) cases where applicable
  - Test edge cases separately

- **Common test patterns**:
  - **Type inference**: Check that types are inferred correctly without annotations
  - **Polymorphism**: Test generalization/instantiation (see `let-polymorphism.test.ts`)
  - **Constraints**: Verify unification constraints are generated correctly
  - **Scoping**: Test variable binding, shadowing, and closure capture
  - **Recursion**: Test recursive definitions with Mu terms

### Module-level tests (under `src/elaboration/__tests__`)

- Tests for full module elaboration (top-level let declarations, exports, foreign imports)
- Use similar patterns as inference tests but at module granularity

## Conventions & tips

- Path aliases (`tsconfig.json`):
  - `@yap/elaboration/*` → `src/elaboration/*`, `@yap/src/*` → `src/parser/*`, `@yap/shared/*` → `src/shared/*`.
- Expression categories in the parser: `Lambda`, `Pi/arrow`, `Application`, `rows` (struct/tuple/list/variant/tagged), `Projection`, `Injection`, `Block`, `Match`, `Annotation`.
- Elaboration dispatch map lives in `src/elaboration/elaborate.ts`: use this as the authoritative list when adding new AST node handling.
- When modifying the grammar, regenerate and re-run parser tests; many rely on snapshot shapes from `processors.ts`.
- For types/values in tests: pretty via `EB.Display.Term(...)` and `NF.display(...)`, but do not equality-assert exact strings—use snapshots or tolerant regex.
- `src/__tests__` is also outdated. Kept only for ideating and reference.
- `brainstorming/yap` contains design documents, specs, sketches, and experimental code:
  - `ROADMAP.md` — prioritized feature roadmap (P0–R&D): WHNF semantics, verification overhaul, spine apps, row constructors, equi-recursive types, modality polymorphism, coeffects, delimited continuations.
  - `Backlog.md` — short task list: spineful apps, row fns, monad refactors, lowering IR, partial evaluation, tree-sitter migration.
  - `spec.md` — formal-ish specification of Yap's core type theory: syntax, typing judgments, subtyping, CBV operational semantics.
  - `liquids.yap` — examples/tests for liquid refinement types (`Nat`, `Pos`, HOF interactions, arithmetic).
  - `shift-reset.yap` / `shift-reset.txt` — delimited continuation design sketches and reference paper (Cong & Asai, ICFP 2018).
  - `syntax-modifications.yap` — brainstorming alternative syntax for rows, structs, tuples, maps, arrays, projections, injections.
  - `indexing.yap` — design sketch for `Indexed` type with `Strategy` record and foreign-backed hashmap bindings.
  - `test.yap` — experimental playground: coercion types, LUB types, typeclass-like structs, precision-parameterized integers.
  - `lib.yap` / `main.yap` — fairly stable standard-library and main-module sketches (refined types, `List`, `Array`, `Functor`).
  - `debug.yap` — basic smoke tests for primitives, lambdas, application, composition.
  - `data/` — data structure sketches: `functor.yap` (Functor record), `list.yap` (recursive List + Functor instance), `map.yap` (HashMap), `indexing.yap` (generic Strategy + JS FFI).
  - `ffi/` — FFI binding sketches for C (`c.ffi.yap`) and JS (`js.ffi.yap`).
  - `brainstorming/` — older `.lama`/`.pl` sketches: unification problems, row polymorphism, SMT encoding ideas.

## Examples

- Parse and elaborate a term (see `src/elaboration/inference/__tests__/util.ts` for a full helper):
  - Parse: build a Nearley parser with `ParserStart = "Ann"`, then `parser.feed(src)`.
  - Elaborate: `EB.infer(term)` under V2; collect with `V2.listen()` to get constraints/metas.

## Common pitfalls

- Forgetting `npm run nearley` after changing `grammar.ne` → tests will use stale `grammar.ts`.
- Not resetting supplies before tests → nondeterministic meta/var IDs in snapshots.
- `NF.Value` is a branded type (`Types.Brand<symbol, Constructor> & { id }`). `Extract<NF.Value, { type: "Abs" }>` resolves to `never`. Use intersection instead: `NF.Value & { binder: { type: "Pi"; ... }; closure: NF.Closure }`.
- CST nodes use `SyntaxType.X` enum values (e.g. `SyntaxType.Lambda`, `SyntaxType.Elam`) in ts-pattern, not raw string literals like `"lambda"`.

## Tree-sitter migration (v2)

The codebase is migrating from Nearley to tree-sitter. V2 files coexist with v1.

### CST structure

- The tree-sitter grammar lives in `tree-sitter-yap` (external package).
- CST node types are generated into `src/parser/types/generated.d.ts`. Regenerate after grammar changes:
  ```sh
  pnpm ts-dts
  ```
- Field access:
  - Nodes with named fields → `CST.Utils.extractFields(node, "field1", "field2")` (type-safe via `YapFieldMap`).
  - Nodes with empty field maps (e.g. `param`, `typing`) → `CST.Utils.extractParam(node)` or positional access (`firstNamedChild`, `namedChildren`).
  - XOR fields (e.g. `lambda` has `explicitNode` xor `implicitNode`) → access via typed properties directly.

### v2 elaboration conventions

- V2 elaboration drops usages/multiplicities (deferred to verification pass).
  - `check` returns `EB.Term`, not `[EB.Term, Q.Usages]`.
- Inference v2 modules live in `src/elaboration/inference.v2/`.
- Checking v2 modules live in `src/elaboration/checking.v2/`.
- Checking modules are organized by **term shape** at the top-level dispatch (`check.ts`), then by **type shape** within each module (e.g. `struct.ts` matches on Type/HashMap/Schema/Sigma).
- Current checking.v2 modules: `check.ts` (dispatcher), `pi.ts`, `struct.ts`, `row.ts` (shared helpers), `variant.ts`, `tuple.ts`, `injection.ts`, `tagged.ts`. Still missing: `match.ts`, `modal.ts`.
- Each v2 directory has a `tmp.ts` stub as a central dispatch for `check`/`infer`. These are temporary stubs (`return 1 as any`) that will be wired to the full dispatcher later. Import from `./tmp` within sibling modules.
- V1 files are kept alongside for reference but are not used by v2 code.

## Instruction self-maintenance

These instructions are a living document. During any session, the agent should be proactive and **actively validate** claims made here against the actual codebase and flag discrepancies to the user. Specifically:

- **On session start**: Spot-check key structural claims (file paths, module organization, naming conventions, API signatures) against the codebase as you encounter them.
- **`package.json` scripts**: The scripts listing in these instructions must stay in sync with the actual `package.json`. At the start of any session that may involve build, test, or CLI commands, verify the scripts here match reality. If a script was added, removed, renamed, or its command changed, flag it and propose an update. When a session introduces a new useful command or workflow (e.g., a one-liner for regenerating types, a debug script), suggest adding it as a `package.json` script and updating these instructions accordingly.
- **Flag conflicts**: If an instruction contradicts the current state of the code (e.g., a file/module mentioned here no longer exists, a function signature has changed, a convention is no longer followed), inform the user explicitly and suggest updating the instructions.
- **Flag outdated info**: If v2 code has matured beyond the "migration" framing (e.g., `tmp.ts` stubs are replaced with real dispatchers, v1 files are removed, new patterns have emerged), proactively note that the instructions should be updated to reflect the new baseline.
- **Flag missing info**: If you discover important patterns, conventions, or architectural decisions during the session that are not documented here, suggest adding them.
- **How to flag**: Briefly state what is outdated/conflicting, what the current state is, and propose a concrete update. Ask the user whether to apply it.
- **Project documentation**: When a session introduces changes that affect user-facing documentation—`README.md`, `FAQ.md`, or `examples/`—check whether those documents are still accurate. Flag any drift (e.g., outdated CLI usage, missing features, stale examples, incorrect API descriptions) and propose updates.
- **Architecture records**: When a session changes compiler pipeline structure, adds/removes modules, modifies key data types, or alters cross-cutting concerns (monad, context, constraint flow), check whether the relevant `z-yap` records and thread hubs are still accurate. Propose updates if they have drifted.
- **Examples and README alignment**: The `examples/` folder, `examples/README.md` (the language tour), `README.md`, and `FAQ.md` must stay in sync with each other and with the actual language capabilities. When a session implements, removes, or changes a language feature, check whether these documents reflect the new reality. Flag stale feature statuses, broken code snippets, dead file references, and undocumented examples. The integration test `src/__tests__/integration/examples-readme.repl.test.ts` validates README snippets — changes to README examples must stay in sync with this test.
- **Known documentation issues**: Discovered documentation drift should be recorded in `z-yap/zettels/documentation-debt.md` or a more specific ZK work item when it cannot be fixed in the current session.

## Agent interaction style

The agent should adopt a **collaborative, question-driven** approach. Specifically:

- **Never guess or assume**: If something is unclear—design intent, desired behavior, naming, scope of a change—ask the user before proceeding. Do not silently make decisions that could take the work in the wrong direction.
- **Surface contradictions**: If the instructions, code, tests, and comments disagree with each other, always surface the contradiction to the user. Never resolve conflicts silently — explain the discrepancy and ask the user how to proceed.
- **Propose approaches, let the user choose**: When there are multiple valid ways to implement something, present the options with brief trade-offs and let the user decide. Default to the simplest option but still surface the choice.
- **Surface emergent problems early**: If during implementation you encounter something unexpected (a type mismatch, a missing case, an architectural inconsistency), stop and inform the user. Propose how to handle it and ask for confirmation before continuing.
- **Handle errors transparently**: When a tool call fails, a type error appears, or a test breaks, explain what went wrong, why it likely happened, and propose a fix. Do not silently retry or work around errors without informing the user.
- **Ask before running tests**: Do not proactively run tests. Before running any test suite, explain which tests would be run, what they cover, and verify with the user that they are still relevant and suitable for validating the current change.
- **Validate at each step**: For multi-step tasks, pause after each meaningful step to let the user review and validate the work before moving on. Do not batch multiple steps without confirmation unless the user explicitly asks for it.
- **Ask, don't tell**: Prefer "Should we X?" or "Would you like me to Y?" over "I will now X" when the decision has meaningful consequences.

### Design sessions

The collaborative, question-driven defaults above apply to implementation work. For design discussions (exploring type system semantics, language features, compiler architecture, PL theory), the agent should shift posture:

- Prioritize independent analysis over deference. Bring frameworks, prior art, and recommendations without being asked.
- Hold and defend positions. When the user explores a tentative idea, engage critically — don't just validate it.
- Ground claims in z-yap and existing design docs. Read before speaking.
- Surface what the user doesn't already know. If a response only restates what the user said, it added nothing.

## Codebase awareness and deduplication

The agent should maintain broad awareness of the project and actively cross-reference new work against existing code. The goal is to avoid circular ideation, duplicated effort, and forgetting prior decisions.

- **Surface existing solutions**: Before implementing new functionality, check whether a utility, abstraction, or pattern already solves the problem (or a close variant). If found, inform the user and ask whether to reuse, extend, or intentionally diverge.
- **Flag similar code**: If existing code has overlapping semantics — similar helpers, redundant pattern matches, near-duplicate logic — point it out. This includes code in other modules, v1 counterparts, or brainstorming sketches.
- **Track deferred work**: When encountering `TODO`, `FIXME`, `HACK`, skipped/pending tests, or deferred features that are relevant to the current task, surface them. Prior decisions captured in comments or notes should inform current work rather than be rediscovered from scratch.
- **Reference sketches and ideas**: The `brainstorming/yap` folder contains ideas, specs, and experimental code. When working on a feature that may have been explored there, check it and surface relevant prior art.
- **Warn on drift**: If the user is about to reintroduce a pattern that was previously refactored away, or re-implement something that already exists under a different name, flag it before proceeding.

## V2 migration awareness

The codebase is undergoing a major migration from v1 (Nearley AST-based) to v2 (tree-sitter CST-based) elaboration. The migration plan, current status inventory, and open decisions are tracked in `brainstorming/yap/V2-MIGRATION.md`. The agent should treat this document as a living companion to these instructions:

- **Stay informed**: When a session touches elaboration, inference, checking, parsing, or the compiler pipeline, use `read_file` to load `brainstorming/yap/V2-MIGRATION.md` at the start to understand the current migration state and open blockers.
- **Assess impact**: When implementing a feature or refactor, consider whether it affects the v2 migration. If the change touches v1 code that has a v2 counterpart, flag it and ask whether the v2 module should be updated in parallel.
- **Flag regression risk**: If a change to shared infrastructure (monad, normalization, unification, context, constructors, display) could break v2 modules, surface the concern before proceeding.
- **Keep the document in sync**: If a session completes a migration step, changes the status of a module, adds/removes files in `inference.v2/` or `checking.v2/`, or resolves an open decision, propose an update to `brainstorming/yap/V2-MIGRATION.md` to reflect the new state.
- **Surface migration opportunities**: If work in a session naturally aligns with a pending migration step (e.g., wiring `tmp.ts`, adding a missing module, writing tests), mention it and ask whether to tackle it as part of the current work.
- **Warn on v1-only changes**: If the user is adding significant new functionality exclusively to v1 inference/checking modules without a v2 counterpart, flag the potential migration debt.

## Session continuity

When a session includes prior context (conversation summaries, todo lists, or references to earlier work):

- **Review and acknowledge**: At the start, review any provided prior context and briefly acknowledge what was done, what is pending, and any open decisions. This ensures both the agent and user are aligned before continuing.
- **Carry forward decisions**: Prior design decisions, naming choices, and architectural directions should be treated as established unless the user explicitly revisits them.
- **Resume, don't restart**: Pick up where the previous session left off. Do not re-derive conclusions or re-explore options that were already settled.
