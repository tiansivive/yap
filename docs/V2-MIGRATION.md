# V2 Elaboration Migration

> Last updated: 2026-02-23

This document tracks the migration from v1 (Nearley AST-based) to v2 (tree-sitter CST-based) elaboration.

---

## Table of Contents

- [Current State](#current-state)
  - [V2 Monad](#v2-monad)
  - [V2 Evaluator](#v2-evaluator)
  - [V2 Unification](#v2-unification)
  - [inference.v2/](#inferencev2)
  - [checking.v2/](#checkingv2)
  - [Wiring](#wiring)
- [Migration Action Plan](#migration-action-plan)
  - [1. Wire tmp.ts dispatchers](#1-wire-tmpts-dispatchers)
  - [2. Finish checking.v2](#2-finish-checkingv2)
  - [3. Add modal.ts to inference.v2](#3-add-modalts-to-inferencev2)
  - [4. Write inference.v2 tests](#4-write-inferencev2-tests)
  - [5. Create v2 entry point](#5-create-v2-entry-point)
  - [6. Drop v1 usages from return types](#6-drop-v1-usages-from-return-types)
- [Detailed Plan: inference.v2 tests](#detailed-plan-inferencev2-tests)

---

## Current State

### V2 Monad

|            |                                                    |
| ---------- | -------------------------------------------------- |
| **File**   | `src/elaboration/shared/monad.v2.ts`               |
| **Status** | **Production-ready** — actively used by v1 modules |
| **Lines**  | ~360                                               |

`Elaboration<A>` is a reader-writer-state-either monad: `(ctx, w?, st?) => [Collector<A>, MutState]`.
`Collector` carries constraints, binders, metas, zonker, types, and `Either<Err, A>` result.
`MutState` tracks delimitations (shift/reset), skolems, and nondeterminism state.
Exports `Do`, `of`, `ask`, `local`, `tell`, `listen`, `traverse`, `fold`, `track`, `getSt`, `modifySt`, `pure`, `regen`.

The "v2" label is historical — this is the active monad used throughout the codebase.

### V2 Evaluator

|            |                                                                             |
| ---------- | --------------------------------------------------------------------------- |
| **File**   | `src/elaboration/normalization/evaluation.v2.ts`                            |
| **Status** | **Fully implemented + tested**                                              |
| **Lines**  | ~1057                                                                       |
| **Tests**  | `src/elaboration/normalization/__tests__/evaluation.v2.test.ts` (183 lines) |

Stack-based trampoline (`workStack` + `resultStack`) replacing JS call-stack recursion.
Configurable `maxSteps` guard (default 10M). Tested at 10k recursion depth.
Handles all term forms: Lit, Var, App, Lambda, Pi, Struct, Proj, Inj, Match, Sigma, Modal, Reset, Shift, Array, Indexed, Foreign, Mu, Let, etc.

### V2 Unification

|            |                                                                            |
| ---------- | -------------------------------------------------------------------------- |
| **Tests**  | `src/elaboration/unification/__tests__/unification.v2.test.ts` (299 lines) |
| **Status** | Tests are comprehensive                                                    |

Covers: literal unification, lambda/Pi unification, rigid variable mismatch, meta binding (flex), occurs check, row unification (extensions, row variables, tail variables), struct fields, substitution composition, nested Pi/Lambda, multi-meta propagation, flex-flex unification.

### inference.v2/

|               |                                                                              |
| ------------- | ---------------------------------------------------------------------------- |
| **Directory** | `src/elaboration/inference.v2/`                                              |
| **Status**    | **22/23 modules individually implemented; dispatch stub blocks integration** |
| **Tests**     | `__tests__/` directory exists but is **empty**                               |

| Module            | Lines | Status   | Notes                                                                                     |
| ----------------- | ----- | -------- | ----------------------------------------------------------------------------------------- |
| `tmp.ts`          | 24    | **Stub** | `check`, `infer`, `Stmt.infer` all `return 1 as any`. Central dispatch — **hard blocker** |
| `annotation.ts`   | 23    | Done     | Infers annotation nodes via check + evaluate                                              |
| `application.ts`  | 94    | Done     | Spine-based application with implicit insertion                                           |
| `block.ts`        | 78    | Done     | Recursive let bindings, statement sequencing                                              |
| `dictionaries.ts` | 38    | Done     | Dictionary/Indexed type inference                                                         |
| `holes.ts`        | 24    | Done     | Fresh meta for hole                                                                       |
| `injection.ts`    | 106   | Done     | Row injection with fold over assignments                                                  |
| `lambda.ts`       | 68    | Done     | Chain-walking elam/ilam with Pi construction                                              |
| `lists.ts`        | 50    | Done     | List literal inference with element unification                                           |
| `literal.ts`      | 42    | Done     | All literal types (String, Num, Bool, Unit, Row, Type)                                    |
| `match.ts`        | 124   | Done     | Match with alternative unification + pattern elaboration                                  |
| `patterns.ts`     | 255   | Done     | Comprehensive (literal, variable, struct, variant, tuple, wildcard, etc.)                 |
| `pi.ts`           | 53    | Done     | Pi/Arrow type inference with multi-param domain support                                   |
| `projection.ts`   | 132   | Done     | Record projection with row-polymorphic inference                                          |
| `reset.ts`        | 64    | Done     | Delimited continuations (reset) with answer-type polymorphism                             |
| `rows.ts`         | 45    | Done     | Row field collection with sigma context and tail support                                  |
| `shift.ts`        | 95    | Done     | Delimited continuations (shift) with continuation binding                                 |
| `sigma.ts`        | 44    | Done     | Sigma context extraction for dependent records (**v2-only**)                              |
| `statements.ts`   | 136   | Done     | Let declarations with constraint solving + generalization                                 |
| `structs.ts`      | 89    | Done     | Struct inference with sigma context + row construction                                    |
| `tagged.ts`       | 30    | Done     | Tagged value inference with variant row type                                              |
| `tuples.ts`       | 25    | Done     | Delegates to `commonStructInference` with numeric labels                                  |
| `variants.ts`     | 18    | Done     | Variant type inference (checks against Type)                                              |

#### V1 ↔ V2 inference module comparison

| V1 Module         | V2 Counterpart    | Notes                            |
| ----------------- | ----------------- | -------------------------------- |
| `annotations.ts`  | `annotation.ts`   | Name: plural → singular          |
| `applications.ts` | `application.ts`  | Name: plural → singular          |
| `block.ts`        | `block.ts`        | —                                |
| `dictionaries.ts` | `dictionaries.ts` | —                                |
| `holes.ts`        | `holes.ts`        | —                                |
| `injection.ts`    | `injection.ts`    | —                                |
| `lambda.ts`       | `lambda.ts`       | —                                |
| `lists.ts`        | `lists.ts`        | —                                |
| `literal.ts`      | `literal.ts`      | —                                |
| `match.ts`        | `match.ts`        | —                                |
| `patterns.ts`     | `patterns.ts`     | —                                |
| `pi.ts`           | `pi.ts`           | —                                |
| `projection.ts`   | `projection.ts`   | —                                |
| `reset.ts`        | `reset.ts`        | —                                |
| `rows.ts`         | `rows.ts`         | —                                |
| `shift.ts`        | `shift.ts`        | —                                |
| `statements.ts`   | `statements.ts`   | —                                |
| `structs.ts`      | `structs.ts`      | —                                |
| `tagged.ts`       | `tagged.ts`       | —                                |
| `tuples.ts`       | `tuples.ts`       | —                                |
| `variants.ts`     | `variants.ts`     | —                                |
| `modal.ts`        | **MISSING**       | V1 has it, v2 does not           |
| `index.ts`        | **MISSING**       | V1 barrel re-export; v2 has none |
| —                 | `sigma.ts`        | V2-only module                   |

### checking.v2/

|               |                                                                         |
| ------------- | ----------------------------------------------------------------------- |
| **Directory** | `src/elaboration/checking.v2/`                                          |
| **Status**    | **Row-based + Pi checking complete; match/modal/literal still missing** |

| File           | Lines | Status   | Notes                                                                                                                                                                          |
| -------------- | ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tmp.ts`       | 14    | **Stub** | `check` and `infer` both `return 1 as any`. Central dispatch — blocks integration                                                                                              |
| `check.ts`     | ~75   | **Done** | Main dispatcher: Hole, Lambda×Pi, implicit Pi insertion, Struct, Variant, Tuple, Injection, Tagged, infer+unify fallthrough                                                    |
| `pi.ts`        | 92    | **Done** | Lambda chain checking against Pi, implicit insertion, infer+unify fallthrough                                                                                                  |
| `struct.ts`    | ~95   | **Done** | Struct checked against Type, HashMap, Schema, Sigma. All cases inlined in match arms                                                                                           |
| `row.ts`       | 229   | **Done** | Row checking helpers: `check` (fields against a single type), `extractBindings`, `traverse` (structural row traversal against expected NF row)                                 |
| `variant.ts`   | ~40   | **Done** | Variant checked against Type (fold over TaggedNode[], check payloads against Type, wrap in Variant row). Infer+unify fallthrough                                               |
| `tuple.ts`     | ~50   | **Done** | Tuple checked against Type (numeric string keys, optional tail). Infer+unify fallthrough                                                                                       |
| `injection.ts` | ~50   | **Done** | Injection checked against Type (fold over assignments, check values against Type). Infer+unify fallthrough                                                                     |
| `tagged.ts`    | ~45   | **Done** | Tagged checked against Variant type (look up tag in variant row via R.rewrite, check payload against expected type). **New rule — no v1 counterpart**. Infer+unify fallthrough |

**Still missing checking.v2 modules:**

- `match.ts` — match checking (against Type and against arbitrary types with pattern narrowing)
- `modal.ts` — modal checking (strip Modal wrapper, check inner with liquid refinements)

### Wiring

**V2 is completely disconnected from the main pipeline.**

- `elaborate.ts` — dispatches exclusively to v1 via `EB.Lit.infer`, `EB.Lambda.infer`, etc.
- `index.ts` — re-exports `./inference` (v1) and `./shared/monad.v2`. No v2 inference/checking imports.
- `module.ts` — uses V2 monad but dispatches through v1 inference.
- The only cross-reference: `checking.v2/check.ts` has a dynamic `import("../inference.v2/tmp")` — but that file is broken and unreachable.

---

## Migration Action Plan

### 1. Wire `tmp.ts` dispatchers

**Goal:** Replace the `return 1 as any` stubs with real dispatch logic.

- **`inference.v2/tmp.ts` `infer`**: Add `match(node.type)` routing to sibling modules, mirroring the dispatch map in `elaborate.ts`.
- **`inference.v2/tmp.ts` `check`**: Route to `checking.v2/check.ts` (or inline a minimal checker: hole, lambda-against-pi, implicit insertion, infer+unify fallthrough).
- **`inference.v2/tmp.ts` `Stmt.infer`**: Route to `statements.ts`.

This is the **hard prerequisite** for everything else — all modules depend on `tmp` for mutual recursion.

### 2. Finish checking.v2

- ~~Fix the broken code in `check.ts`~~ ✅ Done (2026-02-23)
- ~~Implement `struct.ts`, `row.ts`~~ ✅ Done (2026-02-22)
- ~~Implement `variant.ts`, `tuple.ts`, `injection.ts`, `tagged.ts`~~ ✅ Done (2026-02-23)
- Implement `match.ts` — match checking (against Type and against arbitrary types with pattern narrowing)
- Implement `modal.ts` — modal checking (strip Modal, check inner, liquid refinements)
- Wire `checking.v2/tmp.ts` to the real dispatcher in `check.ts`

**Design note:** V2 checking drops usages/multiplicities — `check` returns `EB.Term`, not `[EB.Term, Q.Usages]`. Multiplicity verification is deferred to the verification pass.

**Design note:** `tagged.ts` is a new checking rule with no v1 counterpart — it checks `#Tag payload` against a `Variant` type by looking up the tag in the variant's row and propagating the expected payload type downward.

### 3. Add `modal.ts` to inference.v2

Present in v1, absent in v2. Needed for modality inference (QTT multiplicities + liquid refinements).

### 4. Write inference.v2 tests

**Blocked by:** Step 1 (tmp.ts wiring).

See [Detailed Plan: inference.v2 tests](#detailed-plan-inferencev2-tests) below.

### 5. Create v2 entry point

Either:

- **Modify `elaborate.ts`** to detect CST nodes and route through v2
- **Create a new `elaborate.v2.ts`** with a clean CST-based dispatcher

This also requires updating `module.ts` and `compile.ts` to parse with tree-sitter instead of Nearley.

### 6. Drop v1 usages from return types

V1 inference returns `[EB.Term, NF.Value, Q.Usages]` (the `AST` type in `elaborate.ts`).
V2 returns `[EB.Term, NF.Value]` — usages are deferred to verification.

Once v2 is wired in, strip `Q.Usages` from the pipeline and clean up v1 usage-related code.

---

## Detailed Plan: inference.v2 tests

### Phase 0 — Prerequisite: Wire `tmp.ts`

Before any test can exercise real behavior, `tmp.ts` dispatchers must be wired (see [Step 1](#1-wire-tmpts-dispatchers)). Without this, any module calling `tmp.check(...)` or `tmp.infer(...)` returns `1 as any`.

**Decision needed:** How far to wire `tmp.ts`?

- **Minimal**: Just enough for inference tests to recurse (e.g., skip modal, partial checking)
- **Full**: Complete dispatcher, effectively doing Step 1 at the same time

**Decision needed:** How to handle `check` calls from inference modules?

- **Option A**: Fix `checking.v2/check.ts` first (Step 2)
- **Option B**: Inline a minimal fallback checker in `inference.v2/tmp.ts` (hole, lambda-against-pi, implicit insertion, infer+unify fallthrough)

### Phase 1 — Test infrastructure

**Create `src/elaboration/inference.v2/__tests__/util.ts`**

A tree-sitter-based helper analogous to `inference/__tests__/util.ts`:

```ts
import Parser from "tree-sitter";
import Yap from "tree-sitter-yap";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Lib from "@yap/shared/lib/primitives";

import * as tmp from "../tmp";

const mkParser = () => {
	const parser = new Parser();
	parser.setLanguage(Yap);
	return parser;
};

const parseCSTExpr = (src: string) => {
	const tree = mkParser().parse(src);

	if (tree.rootNode.hasError) {
		throw new Error("Parse error");
	}
	// Extract the expression node from the root program node
	// Extract the expression node from the root program node
	return tree.rootNode.firstNamedChild!;
};

export const elaborateFrom = (src: string) => {
	EB.resetSupply("meta");
	EB.resetSupply("var");
	EB.resetId();
	NF.resetId();

	const node = parseCSTExpr(src);
	const ctx = Lib.defaultContext();

	// ... run tmp.infer(node) inside V2 monad
	// ... collect constraints, metas, types, zonker
	// ... return { displays, structure } matching v1 shape
};
```

**Smoke test**: Parse `1` and `true`, run through `tmp.infer`, verify `displays.type` is `"Num"` / `"Bool"`.

### Phase 2 — Leaf modules (no/minimal recursion through `tmp`)

These modules have no or trivial recursive dispatch, so they're safe to test even with a partially-wired `tmp.ts`:

| Test file         | Module       | Key assertions                                              |
| ----------------- | ------------ | ----------------------------------------------------------- |
| `literal.test.ts` | `literal.ts` | Num, Bool, String, Unit, Type, Row literals → correct types |
| `holes.test.ts`   | `holes.ts`   | Fresh meta generation, meta count                           |
| `rows.test.ts`    | `rows.ts`    | Row field collection, tail handling                         |

### Phase 3 — Single-level recursion

Modules that call `tmp.infer`/`tmp.check` on sub-expressions:

| Test file             | Module           | Key assertions                                                               |
| --------------------- | ---------------- | ---------------------------------------------------------------------------- |
| `lambda.test.ts`      | `lambda.ts`      | Explicit/implicit, annotated params, higher-order, chain walking (elam/ilam) |
| `pi.test.ts`          | `pi.ts`          | Pi/Arrow types, multi-param domains                                          |
| `annotation.test.ts`  | `annotation.ts`  | Type annotations check + evaluate                                            |
| `application.test.ts` | `application.ts` | Spine application, implicit insertion                                        |
| `projection.test.ts`  | `projection.ts`  | Record projection, row-polymorphic inference                                 |
| `injection.test.ts`   | `injection.ts`   | Variant injection, row extension                                             |
| `tagged.test.ts`      | `tagged.ts`      | Tagged values → variant row type                                             |
| `lists.test.ts`       | `lists.ts`       | List literals, element type unification                                      |
| `tuples.test.ts`      | `tuples.ts`      | Numeric-label structs                                                        |
| `structs.test.ts`     | `structs.ts`     | Struct inference, sigma context                                              |
| `variants.test.ts`    | `variants.ts`    | Variant type inference (checks against Type)                                 |

### Phase 4 — Complex / compositional modules

| Test file              | Module(s)                    | Key assertions                                                    |
| ---------------------- | ---------------------------- | ----------------------------------------------------------------- |
| `match.test.ts`        | `match.ts` + `patterns.ts`   | Pattern matching, alternative unification                         |
| `block.test.ts`        | `block.ts` + `statements.ts` | Let bindings, recursive defs, constraint solving + generalization |
| `dictionaries.test.ts` | `dictionaries.ts`            | Indexed type inference                                            |
| `shift-reset.test.ts`  | `shift.ts` + `reset.ts`      | Delimited continuations, answer-type polymorphism                 |
| `sigma.test.ts`        | `sigma.ts`                   | Dependent record sigma extraction (v2-only)                       |

### Phase 5 — Cross-cutting / integration

| Test file              | Focus                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `patterns.test.ts`     | Dedicated pattern elaboration: literal, variable, struct, variant, tuple, wildcard, nested        |
| `polymorphism.test.ts` | Let-polymorphism / generalization (analogous to `elaboration/__tests__/let-polymorphism.test.ts`) |
| `implicits.test.ts`    | Implicit insertion across application and checking                                                |

### Test strategy decisions

| Decision                 | Options                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Mirror v1 tests 1:1?** | _Pro_: diff v1 vs v2 output, catch regressions. _Con_: CST structure differs, some tests won't translate directly                                                                                |
| **Snapshot strategy**    | V1 uses heavy snapshots for `{ displays }` and `{ structure }`. Same approach should work for v2, but CST-based `structure` will differ from Nearley-based AST — new snapshots needed regardless |
| **Coverage target**      | At minimum: match v1 test file count (19 test files). Stretch: add v2-only tests for `sigma.ts` and CST-specific edge cases                                                                      |
