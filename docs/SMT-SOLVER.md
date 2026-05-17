# SMT Solver Architecture for Yap

## Scope

Replace the current Z3-specific verification backend with a Yap-owned solver stack.

Keep:
- the current verification pipeline shape: `check`, `synth`, `subtype`, obligation recording, and refinement-driven VC generation
- the existing VC generation algorithm, except where a backend-neutral IR forces light rewrites
- first-order refinement reasoning over the existing core language

Allow:
- replacing `z3-solver` expression construction with a backend-neutral VC IR
- changing `VerificationArtefacts.vc` from solver-native expressions to Yap IR nodes
- adding normalization and lowering passes between VC generation and satisfiability checking

Do not do:
- remove predicate forms already expressible in Yap
- narrow refinement expressiveness to simplify the solver
- replace VC generation with a different verification method

## Lifted requirements from the current verification code

### Required formula forms

From `src/verification/V2/check.ts`, `synth.ts`, `subtype.ts`, and `logic/translate.ts`:

- boolean constants, conjunction, disjunction, negation, implication
- equality and disequality
- guarded universal quantification: `forall x. phi(x) => body`
- existential reasoning from synthesized application/block types
- uninterpreted constants and uninterpreted function application
- arithmetic literals and arithmetic operators: `+`, `-`, `*`, `/`, `%`, comparisons
- string literals and string operators, at minimum concatenation and equality
- row/schema/variant containment and field projection constraints
- recursive use of subtyping obligations inside row values and dependent schemas

### Required theory support

Minimum target:

- EUF: uninterpreted sorts, symbols, equality, congruence
- Arithmetic:
  - linear integer arithmetic for lengths, indices, naturals, positivity, bounds
  - linear real arithmetic for existing `Num -> Real` style reasoning if retained
  - explicit representation for `*`, `/`, `%`
- Quantifiers:
  - universal quantifiers over first-order domains
  - implications as guards inside quantified bodies
  - instantiation over ground terms introduced by verification
- Strings:
  - equality
  - concatenation
  - length
  - prefix, suffix, contains
- Rows:
  - row variables
  - width subtyping / containment
  - row extension / overwrite
  - field lookup
  - dependent row checking should be able to emit obligations on projected field values

### Current hard constraints visible in the code

- `VerificationServiceV2` wires `createCheck`, `createSynth`, `createSubtype`, and `createTranslationTools` around `z3-solver`.
- `VerificationArtefacts.vc` is currently `Expr`.
- `translate.ts` directly constructs Z3 sorts and expressions.
- `quantify()` is the central site for guarded universal quantification.
- `subtype.contains()` already performs row-wise structural comparison; this should remain the semantic source of row containment.
- function checking and modal subtyping rely on translating liquid predicates applied to a fresh rigid.
- strings and rows are not fully supported today:
  - strings use an uninterpreted sort
  - row literals are rejected in translation
  - `$concat` exists as a primitive but is not translated into solver-native string reasoning

## Problem decomposition

The replacement should split into four layers.

1. VC IR
2. VC lowering and normalization
3. Core satisfiability engine
4. Theory modules

The verification pass should stop targeting solver-native expressions directly.

## Proposed architecture

```text
check / synth / subtype
        |
        v
   VC IR builder
        |
        v
normalization + prenex + skolem + trigger extraction
        |
        v
      CDCL(T)
        |
        +-- EUF / congruence closure
        +-- arithmetic
        +-- strings
        +-- rows
        +-- quantifier engine
```

### Architectural choice

Use a DPLL(T) / CDCL(T) solver with a shared term arena and theory plugins.

Reason:
- Yap VCs already have the right shape for SMT solving.
- EUF, arithmetic, strings, and rows are separable theory concerns.
- obligations and explanations map naturally to clause / lemma provenance.
- it keeps VC generation intact and moves the replacement effort into the solver boundary.

## IR changes

### New VC IR

Add a backend-neutral verification IR.

```ts
export namespace VC {
export type Sort =
| { tag: "Bool" }
| { tag: "Int" }
| { tag: "Real" }
| { tag: "String" }
| { tag: "Unit" }
| { tag: "Label" }
| { tag: "Row", value: RowSort }
| { tag: "Fn", args: Sort[], ret: Sort }
| { tag: "Uninterpreted", name: string };

export type RowSort = {
fields: Record<string, Sort>;
tail?: string;
};

export type Term =
| { tag: "Var", name: string, sort: Sort }
| { tag: "Const", name: string, sort: Sort }
| { tag: "Num", value: string, sort: "Int" | "Real" }
| { tag: "Str", value: string }
| { tag: "App", head: string, args: Term[], sort: Sort }
| { tag: "RowEmpty", sort: Sort }
| { tag: "RowExtend", row: Term, label: string, value: Term, sort: Sort }
| { tag: "RowSelect", row: Term, label: string, sort: Sort };

export type Formula =
| { tag: "True" }
| { tag: "False" }
| { tag: "Atom", op: AtomOp, args: Term[] }
| { tag: "Not", value: Formula }
| { tag: "And", values: Formula[] }
| { tag: "Or", values: Formula[] }
| { tag: "Implies", left: Formula, right: Formula }
| { tag: "Forall", binders: Binder[], body: Formula, triggers: Trigger[] }
| { tag: "Exists", binders: Binder[], body: Formula };

export type Binder = { name: string, sort: Sort };
export type Trigger = { terms: Term[] };
export type AtomOp =
| "=" | "!="
| "<" | "<=" | ">" | ">="
| "+" | "-" | "*" | "/" | "%"
| "str.len" | "str.prefix" | "str.suffix" | "str.contains";
}
```

### Required changes in verification types

```ts
export type VerificationArtefacts = {
vc: VC.Formula;
nf?: NF.Value;
};

export type Obligation = {
label: string;
expr: VC.Formula;
context?: {
term?: string;
type?: string;
description?: string | string[];
};
};
```

### Translation boundary

Replace direct Z3 construction with IR construction.

```ts
export type TranslationTools = {
mkSort: (nf: NF.Value, ctx: EB.Context) => VC.Sort;
translateTerm: (nf: NF.Value, ctx: EB.Context, rigids?: Record<number, VC.Term>) => VC.Term;
translateFormula: (nf: NF.Value, ctx: EB.Context, rigids?: Record<number, VC.Term>) => VC.Formula;
quantify: (variable: string, annotation: NF.Value, body: VC.Formula, ctx: EB.Context) => VC.Formula;
};
```

This is the minimum structural change needed to decouple VC generation from Z3.

## Solver runtime

```ts
export type SolveResult =
| { tag: "sat", model: Model }
| { tag: "unsat", core: ClauseId[] }
| { tag: "unknown", reason: string };

export type Solver = {
assert: (f: VC.Formula, origin?: string) => void;
check: () => SolveResult;
push: () => void;
pop: () => void;
explain: (clause: ClauseId) => ProofStep[];
};

export const createSolver = (options: SolverOptions): Solver => {
throw new Error("stub");
};
```

## Internal module layout

```text
src/verification/solver/
  ir.ts
  normalize.ts
  skolem.ts
  cnf.ts
  solver.ts
  context.ts
  trail.ts
  explain.ts
  euf/
    arena.ts
    cc.ts
    ematch.ts
  arithmetic/
    normalize.ts
    simplex.ts
    bounds.ts
    branch.ts
  strings/
    terms.ts
    normalize.ts
    solver.ts
  rows/
    normalize.ts
    solver.ts
  quantifiers/
    triggers.ts
    mbqi.ts
    solver.ts
```

## Theory design

### 1. EUF

Use a hash-consed term arena plus union-find congruence closure.

Core responsibilities:
- intern application terms once
- maintain equivalence classes
- propagate equalities induced by congruent parents
- provide canonical representatives to other theories
- feed trigger matching for quantified formulas

Data structures:

```ts
export type EnodeId = number;

export type Enode = {
id: EnodeId;
head: string;
args: EnodeId[];
sort: VC.Sort;
parent: EnodeId;
rank: number;
classNext: EnodeId;
parents: EnodeId[];
generation: number;
};
```

Pseudocode:

```text
intern(term):
  if hash(term.head, reps(term.args)) exists:
    return existing id
  create enode
  register as parent of each arg
  return id

merge(a, b, reason):
  ra := find(a)
  rb := find(b)
  if ra = rb: return
  union(ra, rb)
  enqueue all parent pairs that became congruent
  while queue not empty:
    (p, q) := pop()
    if head(p) = head(q) and reps(args(p)) = reps(args(q)):
      union(find(p), find(q))
```

### 2. Arithmetic

Use mixed linear integer / real arithmetic.

Base engine:
- simplex tableau for linear constraints
- bounds propagation from literals
- branch-and-bound for integer variables

Mandatory normalization:
- fold ground arithmetic
- rewrite `x + 0`, `x - 0`, `1 * x`, `0 * x`
- linearize constant-coefficient products: `c * x`
- rewrite divisions by constants into normalized rational coefficients when legal
- preserve non-linear terms explicitly when not reducible

Required decision:
- choose whether Yap `Num` in verification is `Int`, `Real`, or dual-sorted
- the solver should be built dual-sorted; the translator can decide mapping policy later

Arithmetic IR normalization stub:

```ts
export const Arithmetic = {
normalizeTerm: (term: VC.Term): VC.Term => term,
normalizeAtom: (atom: VC.Formula): VC.Formula => atom,
};
```

Simplex pseudocode:

```text
assertBound(x <= c):
  tighten upper bound
  if current value violates bound:
    repair(x)

repair(basicVar):
  choose pivotable non-basic var that can move toward feasibility
  if none exists:
    report conflict from responsible bounds
  pivot(basicVar, chosenVar)
```

### 3. Strings

Use a dedicated string theory, not pure EUF.

Supported operations in the first solver design:
- `=`
- `concat`
- `len`
- `prefix`
- `suffix`
- `contains`

Representation:

```ts
export type StrTerm =
| { tag: "Lit", value: string }
| { tag: "Var", name: string }
| { tag: "Concat", parts: StrTerm[] };
```

Core method:
- normalize concatenation to flat forms
- reason over word equations by prefix/suffix decomposition
- emit arithmetic lemmas for lengths
- reduce `prefix/suffix/contains` into concat equalities plus fresh witnesses

Pseudocode:

```text
contains(s, t):
  create fresh u, v
  assert s = concat(u, t, v)

normalizeEq(lhs, rhs):
  flatten lhs, rhs
  cancel shared literal prefixes
  cancel shared literal suffixes
  if one side becomes empty:
    emit length / emptiness lemmas
  else if both sides start with vars:
    branch on prefix relationships or defer to witness split
```

### 4. Rows

Do not encode row reasoning as a generic boxed-value array theory in the first implementation.

Yap already has label-directed row rewrites in the verifier. Reuse that semantic shape and give rows their own theory module.

Representation:

```ts
export type RowTerm = {
fields: Map<string, VC.Term>;
tail?: string;
};
```

Responsibilities:
- normalize row extensions into canonical label order
- collapse overwrites to the latest field value
- solve row equality and containment by label-driven decomposition
- emit child obligations for field values back into the main solver
- maintain row-tail substitutions for open rows

Pseudocode:

```text
contains(left, right):
  for each field l in right.fields:
    if l missing in left and left has no tail:
      conflict
    if l present in left:
      emit equality / subtype obligation on field values
  if right.tail exists:
    unify remaining left tail with right tail
```

This keeps row solving aligned with `subtype.contains()` instead of forcing a new encoding discipline into the verifier.

### 5. Quantifiers

Target fragment:
- guarded first-order universal quantifiers produced by refinement checking
- existential binders introduced during synthesis and skolemized before SAT

Two engines:
- trigger-based E-matching over the EUF arena
- bounded model-based instantiation for formulas that do not get useful triggers

Trigger extraction rule:
- use the guard predicate application and field/string selectors appearing in the quantified body
- reject empty trigger sets; fall back to bounded MBQI

Pseudocode:

```text
quantifierRound():
  for q in activeQuantifiers:
    matches := ematch(q.triggers, eufArena)
    for each new substitution sigma:
      assert instantiate(q.body, sigma)
  if no instances added:
    run bounded MBQI over ground terms by sort
```

Bounded MBQI is acceptable here because Yap's VCs are generated from local program structure, not arbitrary user-written SMT formulas.

## Solving pipeline

### Pass 1. VC normalization

- eliminate trivial `and/or/not`
- flatten nested conjunctions/disjunctions
- inline `Implies(a, b)` as boolean implication or `Or(Not(a), b)` for CNF lowering
- fold ground arithmetic and string literals
- canonicalize row terms

### Pass 2. Quantifier preparation

- prenex where profitable
- skolemize existentials under universal context
- attach triggers
- hoist side conditions for strings and rows into theory facts

### Pass 3. Boolean lowering

- Tseitin transform formulas into clauses
- keep atoms theory-owned
- attach origin metadata for obligations and future unsat-core reporting

### Pass 4. CDCL(T)

- SAT decides boolean skeleton
- theory modules receive asserted literals
- theories propagate equalities / bounds / conflicts
- quantifier engine injects lemmas between fixpoint rounds

## Suggested API changes in verification

### Service shape

```ts
export type VerificationBackend = {
solve: (vc: VC.Formula, obligations: Obligation[]) => SolveResult;
};

export const VerificationServiceV2 = (backend: VerificationBackend, options: VerificationServiceOptions = {}) => {
const runtime = createRuntime(options);
const translation = createTranslationTools(runtime);
const subtype = createSubtype({ runtime, translation });
const check = createCheck({ runtime, translation });
const synth = createSynth({ runtime, translation });

return {
check,
synth,
subtype,
getObligations: runtime.getObligations,
solve: (artefacts: VerificationArtefacts) => backend.solve(artefacts.vc, runtime.getObligations()),
};
};
```

### Translation interface

```ts
export const createTranslationTools = (runtime: VerificationRuntime): TranslationTools => ({
mkSort: (nf, ctx) => ({ tag: "Uninterpreted", name: NF.display(nf, ctx) }),
translateTerm: (nf, ctx, rigids = {}) => { throw new Error("stub"); },
translateFormula: (nf, ctx, rigids = {}) => { throw new Error("stub"); },
quantify: (variable, annotation, body, ctx) => ({ tag: "Forall", binders: [], body, triggers: [] }),
});
```

### Theory registration

```ts
export type Theory = {
name: string;
init: (ctx: SolverContext) => void;
assertLit: (lit: Literal, ctx: SolverContext) => TheoryStep;
check: (ctx: SolverContext) => TheoryStep;
push: (ctx: SolverContext) => void;
pop: (ctx: SolverContext) => void;
};
```

## Algorithms by milestone

### Milestone 1. IR boundary

Implement first.

Deliverables:
- `VC` IR
- translation from `NF.Value` to `VC.Term` / `VC.Formula`
- no solver yet; optional debug printer to s-expression / JSON

Reason:
- removes the direct Z3 dependency from VC generation
- exposes the exact formula fragment Yap emits
- makes solver work testable independently from elaboration

### Milestone 2. EUF + guarded quantifiers + linear arithmetic

Deliverables:
- term arena
- congruence closure
- trigger engine
- simplex + branch-and-bound
- boolean/CDCL core

This is the minimum solver core for most liquid refinement obligations.

### Milestone 3. String theory

Deliverables:
- concat normal forms
- length coupling to arithmetic
- prefix/suffix/contains reductions
- witness generation for contains-like constraints

### Milestone 4. Row theory

Deliverables:
- canonical row term representation
- containment solver
- open-row tail unification
- emission of nested field obligations

### Milestone 5. Explanations and models

Deliverables:
- unsat cores linked back to obligations
- model fragments for counterexamples
- pretty-printer for quantified counterexample contexts

## Open design decisions

### 1. `Num` semantics in verification

Current code maps `Num` to reals.

Options:
- keep `Num = Real` in the solver and add a separate integer sort for lengths only
- move verification to `Int` for `Num`
- keep both and infer per-term numeric kind in translation

Recommendation:
- build the solver dual-sorted (`Int`, `Real`)
- defer the Yap-level mapping decision

### 2. Non-linear arithmetic

Current primitives include `*`, `/`, `%`.

A custom complete nonlinear arithmetic solver is a separate project.

Recommendation:
- keep these operators in IR from day one
- support the linearizable subset first
- add a dedicated nonlinear module later if actual VC usage demands it
- keep NbE constant-folding aggressive so ground arithmetic disappears before solver entry

This preserves expressiveness at the IR boundary and avoids hard-coding a weaker logic into verification.

### 3. Higher-order values in formulas

Current verification already avoids quantifying over non-first-order parameter types.

Recommendation:
- keep that restriction
- represent first-order applications as EUF apps, not arrays
- only encode higher-order values when they appear as opaque constants, not as quantified domains

## Literature and reference implementations

### Architecture

- Nieuwenhuis and Oliveras, *DPLL(T): Fast Decision Procedures*
- Nelson and Oppen, *Simplification by Cooperating Decision Procedures*
- de Moura and Bjørner, *Z3: An Efficient SMT Solver*
- Barbosa et al., *cvc5: A Versatile and Industrial-Strength SMT Solver*

### Arithmetic

- Dutertre and de Moura, *A Fast Linear-Arithmetic Solver for DPLL(T)*
- Z3 `theory_arith` / `theory_lra`

### Quantifiers / EUF

- Ge and de Moura, *Complete Instantiation for Quantified Formulas in SMT*
- Z3 `smt_enode`, `smt_quantifier`
- cvc5 `EqualityEngine`

### Strings

- Liang et al., *A DPLL(T) Theory Solver for a Theory of Strings and Regular Expressions*
- Reynolds et al., *Scaling Up DPLL(T) String Solvers Using Context-Dependent Simplification*
- Z3 `theory_seq`
- cvc5 string solver (`CoreSolver`, `ExtfSolver`)

### Suggested codebases to study

- https://github.com/Z3Prover/z3
- https://github.com/cvc5/cvc5
- https://github.com/OCamlPro/alt-ergo
- https://github.com/bitwuzla/bitwuzla

## Recommendation

Build the solver in this order:

1. VC IR boundary
2. EUF + CDCL + quantifier scaffolding
3. linear arithmetic
4. strings
5. rows
6. explanations/models

The key structural move is not replacing `check` / `synth` / `subtype`.
The key structural move is replacing direct Z3 expression construction with Yap-owned VC IR and then solving that IR with a theory-combined engine.
