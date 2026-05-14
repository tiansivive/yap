# GRS — Graph Rewriting System

DPO (Double Pushout) graph rewriting engine for GRAM.

A rule is `{ lhs, rhs, where? }`. Nodes shared between LHS and RHS (by bind name) form the interface — preserved during rewriting. LHS-only nodes are deleted; RHS-only nodes are created. The pushout engine handles edge rewiring, dangling edge rejection, and node creation/deletion.

Strategies control rule application: `apply` (until exhaustion), `once`, `seq`, `try_`, `choice`, `repeat`.

Reference: GP 2 (University of York), AlgebraicRewriting.jl (Topos Institute), Ehrig et al. "Fundamentals of Algebraic Graph Transformation."
