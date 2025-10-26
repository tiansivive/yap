# Yap Roadmap and Change List

This document organizes upcoming work for Yap into prioritized, actionable tracks with context on the current system, qualitative complexity/effort, and references for deeper topics. Bugs and completion of existing features are highest priority.

Legend

- Priority: P0 = critical/bugs/completion, P1 = important, P2 = nice-to-have, R&D = research/uncertain
- Complexity: Low / Medium / High / Very High
- Effort: Small / Medium / Large / Epic

## Context: what exists today (anchor for decisions)

- Pipeline: Parsing → Elaboration (with deferred constraints) → Verification → Codegen.
- Parser: Nearley-based grammar (`src/parser/grammar.ne` → `grammar.ts`), processors build AST terms.
- Elaboration: Bidirectional checking with constraints; NbE is used for definitional equality checks.
  - Evaluation during elaboration reduces aggressively but preserves neutral spines and does not unfold `mu`.
  - Full normalization happens in Unification, including `mu` unfolding.
- Unification: First-order, runs after elaboration; performs full normalization.
- Verification: Liquid refinements and modalities; emits VCs and checks with Z3. Usage (QTT) collection in elaboration is outdated and intended to move to Verification.
- Modalities: Modal term exists; verification enforces semantics post-elaboration.

## P0 — Correctness, completion, and reliability

1. Clarify and codify evaluation semantics in Elaboration (WHNF)

- Today: Elaboration performs NbE-like reduction that preserves neutral spines and does not unfold `mu`; Unification performs full normalization.
- Action:
  - Document explicitly that elaboration reduces to WHNF (weak head normal form) and preserves neutrals; ensure evaluators match this spec.
  - Audit evaluation entry points to forbid `mu` unfolding during elaboration.
  - Add property tests ensuring equivalence with Unification’s result where appropriate.
- Complexity: Medium | Effort: Medium | Priority: P0
- References: Berger & Schwichtenberg (NbE); Abel (NbE tutorials); TAPL (WHNF vs NF).

2. Finalize usage semantics overhaul into Verification

- Today: QTT-based usage/multiplicity collection during elaboration is deprecated/outdated.
- Action: Remove residual usage inference from elaboration; move/implement usage checks in Verification where VCs are solved; add tests.
- Complexity: Medium | Effort: Medium | Priority: P0
- References: Atkey, “Syntax and Semantics of Quantitative Type Theory” (2018).

3. Verification error provenance and early VC checking

- Today: VCs are produced; error provenance can be improved.
- Action:
  - Eagerly check VCs during verification to fail fast.
  - Enrich VC generation with provenance spans and context to report actionable errors.
  - Downstream: pretty-print counterexamples where possible (model snippets from Z3).
- Complexity: Medium | Effort: Medium | Priority: P0
- References: Rondon–Kawaguchi–Jhala, Liquid Types (PLDI’08) for error localization patterns.

4. Split the “big monad” into domain-specific monads

- Today: V2 monad (Do-notation) handles elaboration-style Reader/Writer/Either effects.
- Action: Introduce more specific monads/instances: Elaboration, Unification, Verification, CodeGen; centralize shared capabilities but narrow each to its domain. Keep V2 API ergonomics.
- Complexity: Medium | Effort: Medium | Priority: P0
- References: Dunfield & Krishnaswami (bidirectional typechecking) for effect scoping inspiration; typical separation in Agda/Idris implementations.

5. Initialize Z3 solver at startup

- Today: Z3 is initialized on-demand; improve reliability and latency.
- Action: Move Z3 boot and health-check to process startup; provide graceful failure modes and a status endpoint/log.
- Complexity: Low | Effort: Small | Priority: P0
- References: N/A (engineering practice).

## P1 — Core refactors that simplify the system

6. Spineful application representation (“spine apps”)

- Today: Applications are nested; various phases manually peel/construct spines.
- Action: Rework `App` into an explicit spine form (head + argument list), used throughout parsing/elaboration/unification/pretty. This simplifies normalization, matching, and many traversals.
- Benefits: Cleaner unification and pattern handling; unlocks better compilation strategies and more predictable pretty-printing.
- Complexity: High | Effort: Large | Priority: P1
- References: Spine-form terms in LF/Twelf (Pfenning); higher-order pattern unification with spines (Nadathur & Linnell); bidirectional checking over spines (general practice in dependently-typed implementations).
  - Note: “Kovács’s DOE (definitional equality) algorithm” is commonly cited in implementation notes/blogs—use his NbE/defeq notes as guide; add precise citation when locking design.

7. Row terms as dedicated constructors (stop using generic App)

- Today: Row-like constructs piggyback on `App`, adding cognitive overhead in elaboration/unification.
- Action: Introduce explicit constructors for row structures (records/variants/tuples/lists) and their spines. Unify their handling with pretty/printer and traversal.
- Complexity: Medium | Effort: Medium | Priority: P1
- References: Row polymorphism: Rémy; Leijen, “Extensible records with scoped labels”.

8. Telescopes in injections/projections; nested sigma context

- Today: Sigma context exists but nested telescopes for complex rows/variants need better structure.
- Action: Support telescopes in injections/projections, refactor to an array/stack of Sigma contexts; update elaboration rules accordingly.
- Complexity: High | Effort: Large | Priority: P1
- References: Sigma types and telescopes in dependent type theory (Agda/Idris literature; McBride notes).

9. Records vs Indexed syntax: clarify and separate

- Today: Overlap in syntax/semantics can be confusing.
- Action: Provide distinct syntax and surface rules for indexed vs plain records; align projection/elaboration errors with clearer messages.
- Complexity: Medium | Effort: Medium | Priority: P1
- References: Leijen (records), row polymorphism in OCaml/Reason/Meljason notes.

## P1 — Type system extensions that increase expressivity

10. Equi-recursive types via coinduction and bisimulation

- Today: `mu` unfolding is handled in Unification; move to a principled coinductive/bisimulation-based equality.
- Action: Implement bisimulation-style equality checking for equirecursive types; ensure termination by guardedness/contractiveness checks where necessary.
- Complexity: Very High | Effort: Epic | Priority: P1
- References: Amadio & Cardelli (1993); Brandt & Henglein (POPL’98); Pierce (TAPL chap. 21) on recursive types.

11. Modality polymorphism and inference

- Today: Modalities exist; inference is limited.
- Action: Add polymorphism over modalities (graded/modal indices), with inference rules and principal solutions where possible.
- Complexity: High | Effort: Large | Priority: P1
- References: Atkey (QTT); Nuyts–Devriese–Piessens (Fitch-style modal dependent type theory); Katsumata (parametric effect monads) for graded semantics.

12. Effects as a modality; rework implicits as coeffects

- Today: Implicits exist separately; effects are not integrated as modalities.
- Action: Model effects as graded/modal annotations; reinterpret implicits within a coeffect system (context requirements tracked statically), integrate into verification where needed.
- Complexity: High | Effort: Large | Priority: P1
- References: Petricek & Orchard, “Coeffects” (2014); Atkey (parameterised notions of computation, 2009); Levy (Call-by-Push-Value) for effect semantics; graded modal types literature.

## P2 — Ergonomics and language features

13. Variadic arguments with regex-like markers

- Examples: `T::*`, `T::+`, `T::2+` to constrain arity/shape.
- Action: Extend parser + elaboration for varargs constraints; pair with spine apps to simplify implementation.
- Complexity: Medium | Effort: Medium | Priority: P2
- References: Kleene operators in type-level programming; dependent vectors (length-indexed lists) in Agda/Idris.

14. Indexing operator for indexed types + proof-driven projection

- Today: No dedicated indexing operator; projections could use proofs for safety.
- Action: Add an indexing operator; require (or infer) a proof that a key/index exists; allow `.` projection when such proof is available.
- Complexity: Medium | Effort: Medium | Priority: P2
- References: Dependent records and finite maps; length/indexed structures in DT.

15. Delimited continuations (shift/reset)

- Action: Add core syntax/typing rules and CPS or direct-style operational semantics; carefully integrate with modalities and verification.
- Complexity: High | Effort: Large | Priority: P2
- References: Danvy & Filinski (1990, 1994).

16. Reflection and Dynamic types

- Action: Introduce `Dynamic` with safe casts or reflective operations gated by proofs; ensure verification surface remains sound.
- Complexity: High | Effort: Large | Priority: P2
- References: Abadi et al. on dynamic typing; practical systems in Typed Racket/TS.

17. Loop syntax (surface sugar)

- Action: Add surface constructs lowering to recursion/folds with optional termination metrics.
- Complexity: Low | Effort: Small | Priority: P2
- References: N/A (desugaring to core).

18. Termination metrics (sized types / measures)

- Action: Provide sized/structural metrics at the type level; optionally enforce only at type-level first.
- Complexity: High | Effort: Large | Priority: P2
- References: Abel (sized types), termination checking in Agda.

19. Logic programming features; functional patterns

- Action: Explore relational fragments (miniKanren-like) and functional/“view” patterns for expressive matching.
- Complexity: High | Effort: Large | Priority: R&D
- References: Byrd & Friedman (miniKanren); Maranget (compiling pattern matching); view patterns in Haskell.

## Ideas to evaluate during implementation

A) Preserve types as elaborated terms; full evaluation only during Unification

- Rationale: Simplify equality by deferring heavy normalization; might reduce phase coupling.
- Trade-offs: Larger terms in contexts; more normalization pressure in Unification; potential ergonomics wins in Elaboration.
- Complexity: Medium | Effort: Medium | Priority: P1 (dependent on 6/7)

B) Align spines across all term categories (rows, variants, tuples, applications)

- Rationale: Uniform traversals and matching; better pretty-printing; simpler unification.
- Dependency: 6 & 7.

## Acceptance criteria (per theme)

- WHNF semantics clarified: docs + property tests + no `mu` unfolding in elaboration; Unification unchanged but documented as “NF + `mu` unfolding”.
- Usage semantics: zero remaining usage checks in elaboration; verification contains all; tests added.
- Provenance: VC failures include precise spans, term context, and countermodel highlights.
- Monads: separate modules/instances with minimal breakages; no regression in tests; improved readability.
- Spine apps: all internal apps in spine form; fewer ad-hoc peel/build helpers; simpler inference in applications.
- Rows: dedicated constructors + traversals; no `App` encoding for rows.
- Telescopes: injections/projections accept telescopes; nested Sigma stack available.
- Equirecursive: bisimulation-based equality with guardedness checks; performance stable.
- Modalities/Coeffects: modality polymorphism in types; implicits tracked as coeffects; verification interaction documented.

## References (indicative, to guide design)

- NbE & normalization: Peter S. Schwichtenberg & Ulrich Berger, “Normalization by Evaluation”; Andreas Abel, NbE tutorials/notes.
- Recursive types: Roberto M. Amadio & Luca Cardelli, “Subtyping Recursive Types” (1993); Michael Brandt & Fritz Henglein, “Coinductive Axiomatization of Recursive Type Equality and Subtyping” (POPL’98); Pierce, TAPL.
- Spine terms & unification: Frank Pfenning (LF/Twelf) documentation on spine-form; Gopalan Nadathur & Dustin J. Linnell, higher‑order pattern unification with spines.
- Bidirectional typing: Joshua Dunfield & Neel Krishnaswami, “Complete and easy bidirectional typechecking for higher-rank polymorphism.”
- Quantitative/graded/modal: Robert Atkey, “Syntax and Semantics of Quantitative Type Theory” (2018); Shin‑ya Katsumata, “Parametric effect monads” (2014); Nuyts–Devriese–Piessens, Fitch‑style modal dependent type theory.
- Coeffects/implicits: Tomas Petricek & Dominic Orchard, “Coeffects: a calculus of context-dependence” (2014).
- Liquid types: Patrick M. Rondon, Ming Kawaguchi, Ranjit Jhala, “Liquid Types” (PLDI’08).
- Delimited continuations: Olivier Danvy & Andrzej Filinski, “Abstracting control” (1990); “Representing monads” (1994).
- Records/rows: Didier Rémy (row polymorphism); Daan Leijen, “Extensible records with scoped labels”.
- Pattern matching: Luc Maranget, “Compiling pattern matching to good decision trees”.
- Note: For Kovács’s DOE (definitional equality) algorithm, use András Kovács’s implementation notes/blog posts on definitional equality & NbE; add precise citation when we pick a concrete approach.

## Carried over from yap/TODO.md (not yet covered here)

These items remain open in `yap/TODO.md` and are integrated below with suggested placement, priority, and qualitative effort. When we pick them up, lift them into the main sections above to avoid duplication.

- Syntax and surface ergonomics (P2, Medium)
  - Where clause; shorthand match; backcall; custom operator definitions; infix function application (beyond built-ins); multiple-argument lambda sugar; argument pattern matching; allow unicode identifiers (at least apostrophe).
  - Indexing operator syntax `e[0]` / `e["k"]` (already listed as item 14).
  - Type operators for row manipulation; SQL-like data traversal.
- Modalities and effects (P1–R&D)
  - CAS instead of SMT for refinements (R&D, Epic).
  - Call semantics strict/lazy (R&D, Medium); mutation with ref counts (R&D, Large).
- Inference and modules (P1, Large)
  - Mutual recursion and cyclic deps (module-level constraint solving, multi-pass); optional separate module definition files.
  - First‑class polymorphism and higher‑order unification (Epic; ties into spine apps and unification strategy).
  - Track mu‑type unfold/fold for display (P1, Medium), coordinated with equirecursive equality.
- Lowering / Codegen (P1–P2)
  - Type erasure; compiling pattern matches; concrete implementations for indexed/row types (hashmaps, arrays); basic optimizations (inlining, beta/eta).
- Tooling (P1–P2)
  - LSP (P1, Large), syntax highlighter (P2, Medium), REPL (P2, Medium).
- Tech debt (P1)
  - Context closure cleanup (only keep imports/env); improve error stacks.
  - Row ops: rewrite and meet/join to support pattern matching.
  - Monad re-architecture already planned above; complete once domain-specific monads land.
