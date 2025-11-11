# Copilot Instructions for this Repo

This repo implements Yap, a small dependently typed language with structural types, implicits and code verification semantics via modalities (currently QTT-based multiplicities and Liquid type refinements)
It contains a Nearley-based parser and an elaboration/inference pipeline which uses NbE and emits contraints subsequently solved via first order Unification.

## Architecture in 30 seconds

- The compiler is divided into Parsing -> Elaboration (with subsequent Constraint Solving via Unification) -> Verification -> Code Generation
- Parser (src/parser):
  - Grammar: `src/parser/grammar.ne` → compiled to `src/parser/grammar.ts` via `npm run nearley`.
  - AST constructors & processors: `src/parser/processors.ts` build typed terms from tokens; terms are in `src/parser/terms.ts`.
  - Default parse start for expressions is `Ann` (annotation-aware expression) in tests.
- Elaboration/Inference (src/elaboration):
  - Bidirectional algorithm with deferred constraint solving. First Order Unification only.
  - Normalization by Evaluation (NbE) in `src/elaboration/normalization/*`.
    - Values (`src/elaboration/normalization/syntax/*`) are used to check type definitional equality.
  - Entry point: `src/elaboration/elaborate.ts` → `infer(ast)` dispatches by `ast.type` into module-specific inferencers under `src/elaboration/inference/*`.
  - Context (`src/elaboration/shared/context.ts`) defines the context used during elaboration. It includes:
    - An evaluation `env` for NbE
    - An `implicits` lookup context
    - A `sigma` context for dependent records
    - `zonker` and `metas` records for avoiding meta substitution
  - Pretty/Display: `src/elaboration/pretty/*`

- Core Primitives and other Builtins
  - A small set of primitive terms and operations is defined in `src/shared/lib/primitives`

- Verification & modalities: `src/verification/*`, `src/shared/modalities/*`.
  - Modalities are defined via a `Modal` term. During elaboration we infer when needed/possible but defer veryfing semantics to the subsequent Verification pass
  - Liquid refinements
    - Lambda abstraction which returns a Boolean and whose parameter if of the type being refined. Typechecked during elaboration!
    - When possible, we apply the lambda over a concrete value to normalize/reduce the refinement
    - We use a `translation` procedure to convert normalized terms into a SMT compatible logical formula.
    - Bidirectional algorithm enforces subtyping semantics and emits Verification Constraints (VCs) which are then checked for Satisfiability with Z3.
  - Multiplicites/Usage semantics
    - Based on Quantitative Type Theory by Atkey, and inspired by Idris2
    - Currently outdated. Usage inference and collection in Elaboration is deprecated. Will need to be moved to Verification.

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
		"test": "vitest",
		"tsc": "tsc -p ./tsc.tsconfig.json",
		"typecheck": "tsc --noEmit -p ./tsc.tsconfig.json",
		"yap": "ts-node -T ./scripts/cli.ts"
```

We should NOT use `build` while debugging.
Simply run `pnpm yap <file>.yap` to parse, elaborate and verify a yap source file.
Passing `repl` to `yap` will launch an interactive REPL.

If you edit the grammar, run `pnpm run nearley` to regenerate the parser.
Run `pnpm test` to run the tests. You can update snapshots with `pnpm test -u` and run specific tests with `pnpm test <path/to/test/file>`.

## Coding guidelines

### Patterns and abstraction

- Elaboration Monad (V2) (`src/elaboration/shared/monad.v2.ts`)
  - V1 is deprecated. Only kept for reference.
  - Uses generators to model Do Notation and allow imperative idiomatic code.
  - `V2.Do()` takes a generator function and iterates its `yields` with imperative based `ReaderWriterEither r w e` semantics.

### Style guidelines

- Prefer immutable code.
- Prefer simple, linear flow by virtue of V2 Do notation.
- Avoid long `fp-ts` function pipelines as they make debugging harder and more annoying.
- Prefer function composition/pipelines when interstitial variables do not add semantic value.
- Avoid wrapping in unecessary callbacks. e.g. `Array.map(doStuff)` instead of `Array.map(v => doStuff(v))`
- Clean, Clear and Terse code:
  - One letter var names are fine in ML-like fashin. e.g. `Array.map(x =>...)` or `const [x, ...xs] = [1,2,3,4]`.
  - Try to keep function and variable names to only one word. Multi-word names typically indicate a function is doing too much, so refactoring is encouraged
  - Adhere to KISS and DRY. Small functions compose together.
  - Avoid bloated code.
  - Strive for minimalism but avoid cryptic cleveverness.
- Prefer declarative code over imperative when possible.
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

- Parser tests (now split under `src/parser/__tests__`):
  - Create a parser with `const g = { ...Grammar, ParserStart: "Ann" }; new Nearley.Parser(...)`.
  - Always assert `data.results.length === 1`; then snapshot `data.results[0]`.
- Elaboration tests (under `src/elaboration/inference/__tests__`):
  - Determinism: call `EB.resetSupply("meta")` and `EB.resetSupply("var")` before inference.
  - Use `Lib.defaultContext()`; run `EB.infer(term)` inside the V2 monad and read back `{ constraints, metas, types }` via `V2.listen()`.
  - Prefer structural assertions on `structure` (e.g., type node is `Pi`) and keep pretty-printed strings for snapshots only.

## Conventions & tips

- Path aliases (`tsconfig.json`):
  - `@yap/elaboration/*` → `src/elaboration/*`, `@yap/src/*` → `src/parser/*`, `@yap/shared/*` → `src/shared/*`.
- Expression categories in the parser: `Lambda`, `Pi/arrow`, `Application`, `rows` (struct/tuple/list/variant/tagged), `Projection`, `Injection`, `Block`, `Match`, `Annotation`.
- Elaboration dispatch map lives in `src/elaboration/elaborate.ts`: use this as the authoritative list when adding new AST node handling.
- When modifying the grammar, regenerate and re-run parser tests; many rely on snapshot shapes from `processors.ts`.
- For types/values in tests: pretty via `EB.Display.Term(...)` and `NF.display(...)`, but do not equality-assert exact strings—use snapshots or tolerant regex.
- `yap` folder contains yap code examples, ideas and sketches. `lib.yap` and `main.yap` should be considered fairly stable. `debug.yap` is for development purposed. Everything else is mostly sketches.
- `src/__tests__` is also outdated. Kept only for ideating and reference.

## Examples

- Parse and elaborate a term (see `src/elaboration/inference/__tests__/util.ts` for a full helper):
  - Parse: build a Nearley parser with `ParserStart = "Ann"`, then `parser.feed(src)`.
  - Elaborate: `EB.infer(term)` under V2; collect with `V2.listen()` to get constraints/metas.

## Common pitfalls

- Forgetting `npm run nearley` after changing `grammar.ne` → tests will use stale `grammar.ts`.
- Not resetting supplies before tests → nondeterministic meta/var IDs in snapshots.
