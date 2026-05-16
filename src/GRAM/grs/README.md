# GRS — Graph Rewriting System

DPO (Double Pushout) graph rewriting engine for GRAM.

A rule is `{ lhs, rhs, where? }`. Nodes shared between LHS and RHS (by bind name) form the interface — preserved during rewriting. LHS-only nodes are deleted; RHS-only nodes are created. The pushout engine handles edge rewiring, dangling edge rejection, and node creation/deletion.

Strategies control rule application: `apply` (until exhaustion), `once`, `seq`, `try_`, `choice`, `repeat`.

**Limitation: no aggregate patterns.** Rules match a fixed-arity LHS pattern. Passes that must collect a variable-length set of matches before emitting output (e.g., capture analysis — "all vars scoped to this lambda") cannot be expressed as a single rule. They are written as imperative graph traversals instead. LoGRAM (planned) replaces the DPO engine with a Datalog layer over a triple-store substrate, where aggregate patterns are first-class joins.

Reference: GP 2 (University of York), AlgebraicRewriting.jl (Topos Institute), Ehrig et al. "Fundamentals of Algebraic Graph Transformation."
