---
name: Match Expression Lowering
overview: Plan for implementing EB.Match lowering to MIR. Extend Branch to support switch semantics (multi-way dispatch); use decision-tree compilation for nested patterns. Includes research notes and future work for documentation.
todos: []
isProject: false
---

# Match Expression Lowering — Plan

## 1. Summary

Lower `EB.Match(scrutinee, alternatives)` to MIR by:

1. **Extending Branch** to support switch semantics (multi-way dispatch on a scrutinee). No new terminator — Branch becomes our switch.
2. **Decision-tree compilation** (Maranget-style) for nested patterns. Output: nested Branch (switch) + Read + Jump.
3. **Merge via block params** — all case blocks jump to a common merge block with the result. No φ nodes.

---

## 2. Context

### 2.1 Source

- **EB.Match(scrutinee, alternatives)** — [term.ts](src/elaboration/syntax/term.ts) L27
- Each alternative: `{ pattern, term, binders }`
- Patterns: Binder, Var, Lit, Row, Struct, Variant, List, Wildcard

### 2.2 Target (MIR)

- Blocks with `Jump`, `Branch`, `Return`
- Branch is currently binary (`cond ? then : else`) and **unused**
- We extend Branch to support **switch semantics** — multi-way dispatch

---

## 3. Key Decisions

| Decision                 | Choice                                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Branch vs new Switch** | Extend Branch to support switch semantics. Branch = our switch. No new terminator.                                                            |
| **Output shape**         | Nested Branch (switch) + Read + Jump. Not nested binary Branch chains.                                                                        |
| **Nested patterns**      | Supported from Phase 1 via decision-tree compilation.                                                                                         |
| **Tag representation**   | Phase 1: field names (tag name). Document that integer tags can be added later for efficiency.                                                |
| **Pattern order**        | Source order in Phase 1.                                                                                                                      |
| **Exhaustiveness**       | Lowering throws on non-exhaustive match. Open question whether exhaustiveness is required — document in MIR-LOWERING.md and elaboration docs. |
| **Merge point**          | Block params. No φ nodes.                                                                                                                     |
| **Failure**              | Single `L_fail` block that throws.                                                                                                            |

---

## 4. MIR Design: Branch with Switch Semantics

### 4.1 Current Branch (Binary)

```ts
{ type: "Branch"; cond: string; thenTarget: Label; thenArgs: string[]; elseTarget: Label; elseArgs: string[] }
```

### 4.2 Extended Branch (Switch)

**Replace** the binary Branch with a unified form that supports switch semantics:

```ts
type BranchTerminator = {
	type: "Branch";
	scrutinee: string;
	cases: Array<{ value: string; target: Label; args: string[] }>;
	default?: { target: Label; args: string[] };
};
```

- **scrutinee:** SSA var holding the value to dispatch on (tag, literal, etc.).
- **cases:** Array of `{ value, target, args }`. For variant tags, `value` is the tag name (string). For literals, `value` is the literal representation.
- **default:** Optional. Used when no case matches (e.g. non-exhaustive match → `L_fail`).

**Binary case:** A simple `if cond then A else B` becomes Branch with `cases: [{ value: "true", target: L_then, args }, { value: "false", target: L_else, args }]` (assuming cond is a bool).

**Match lowering:** Each constructor rule yields a Branch with one case per constructor tag; nested patterns yield nested Branch blocks.

### 4.3 Migration

- Update [mir.ts](src/lowering/mir.ts) Terminator type: replace old Branch with new Branch (switch form).
- Update pretty printer for `display.terminator`.
- No other consumers of Branch today (it is unused).

---

## 5. Lowering Strategy

### 5.1 Decision Tree (Maranget-style)

Clause matrix: rows = alternatives, columns = scrutinees. Compilation rules:

1. **Variable rule:** All patterns in column are variables → bind and recurse.
2. **Constructor rule:** All patterns are constructors → emit Branch on scrutinee with one case per constructor; recurse on sub-patterns.
3. **Mixture rule:** Split matrix when rules don't apply.

**Output:** Nested Branch (switch) + Read (field access) + Jump (to case blocks). Each case block binds pattern variables, lowers the body, and jumps to the merge block.

### 5.2 Flow

```
Match(scrutinee, alts)
  → lower scrutinee → s
  → build clause matrix from alts
  → compile matrix to decision tree
  → emit Branch (switch form) with cases per tag
  → each case: Read payload fields, recurse on sub-patterns or lower body, Jump merge(result)
  → merge block receives result via params
```

### 5.3 Tag Dispatch

- Variants: `Read(tagName, scrutinee, tagVar)` to get tag. Branch on `tagVar` with cases keyed by tag.
- Literals: Branch on scrutinee with cases keyed by literal value.
- Struct/Row: Read fields, recurse on sub-patterns.

---

## 6. Implementation Phases

### Phase 1: Match Lowering

- Extend Branch in mir.ts to switch form.
- Implement clause-matrix compiler for full pattern set (Variant, Struct, List, Lit, Wildcard, Binder).
- Nested patterns from the start.
- Source order. Failure block throws.
- Update pretty printer. Add tests (snapshots).

### Phase 2: Documentation

- MIR-LOWERING.md: Update §3.7 Terminators (Branch = switch form); add Match lowering section.
- Document tag representation (field names; note integer-tag future).
- Document exhaustiveness open question.
- Add research notes and future work to relevant docs (see §8).

### Phase 3: Optimization (Deferred)

- Backend: Dense tags → jump table; sparse → binary search or if-chain.
- DAG sharing for common sub-matches.

---

## 7. Research and Literature

| Source                           | Contribution                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Maranget (2008)**              | Decision trees, necessity heuristics, DAG sharing. [ML 2008](https://pauillac.inria.fr/~maranget/papers/opat/pat003.html) |
| **Le Fessant & Maranget (2001)** | Earlier optimizing match compiler.                                                                                        |
| **Wadler (1987)**                | Semantics of pattern matching; foundational.                                                                              |
| **Augustsson (1985)**            | Compilation of lazy pattern matching.                                                                                     |
| **Bernstein (1985)**             | Range tests, partitioning sparse case lists (Pascal).                                                                     |
| **Spuler (1994)**                | Survey of switch compilation (jump tables, binary search, hybrid).                                                        |

**Takeaway:** Mainstream ML compilers use decision-tree compilation. Backend chooses jump table vs. test sequence based on case density.

---

## 8. Future Work (for Documentation)

### 8.1 Functional Patterns (Curry-style)

**Yap does not support functional patterns yet.** In Curry, patterns can contain function symbols:

```curry
last (_++[e]) = e
```

- **Unification vs. pattern matching:** Functional patterns require runtime unification, not just deconstruction. The pattern `_++[e]` unifies scrutinee with (some list ++ [e]).
- **Compilation:** Narrowing (unification + reduction); possibly backtracking. Cannot use pure decision trees.
- **References:** Curry tutorial §3.5.5; Hanus FLOPS 2002; narrowing machines.
- **Document:** Added to docs/MIR-LOWERING.md §9.1 (Out of Scope). Elaboration impact noted in MIR-LOWERING.md, docs/TODO.md, brainstorming/yap/V2-MIGRATION.md, src/elaboration/ARCHITECTURE.md.

### 8.2 Integer Tags

Phase 1 uses field names. Document that integer tags can improve efficiency later.

### 8.3 Exhaustiveness

Open question: is exhaustiveness required? Document in MIR-LOWERING.md and elaboration docs.

---

## 9. Suggested Next Steps

1. Extend Branch in mir.ts to switch form; update pretty printer.
2. Implement clause-matrix compiler in lower.ts.
3. Add Match lowering tests (snapshots).
4. Update MIR-LOWERING.md: Branch spec, Match lowering, tag representation, exhaustiveness note.
5. Add research notes and future work (§8) to MIR-LOWERING.md as part of implementation.
