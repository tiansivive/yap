---
name: yap-reviewer
description: >-
  Spawn an independent reviewer agent to audit Yap code against the project's
  strict style contract. Use when the user asks to review, audit, or check code
  quality after implementation, or when a plan includes an audit/review pass.
  Detects: type assertions, mutation, else blocks, null usage, loose equality,
  narration comments, missing provenance, ts-pattern violations, fp-ts misuse.
---

# Yap Code Style Reviewer

Spawns a separate agent to review code. The reviewer receives only the rules
and file paths — never the implementation rationale. This breaks self-review
bias that causes author-run audits to rubber-stamp their own decisions.

## When to use

- After completing an implementation task that includes an audit/review step.
- When the user explicitly asks for a review, audit, or style check.
- When a plan's final todo is an "audit pass."

## Procedure

1. Collect changed/created files (`git diff --name-only` against base branch, or from the task's file list).
2. Fill the reviewer prompt template below with the file paths.
3. Spawn a `generalPurpose` subagent via the `Task` tool with the filled prompt.
4. Present the reviewer's report verbatim. Do not filter or downplay findings.

**Do not include** in the subagent prompt: conversation history, plan documents, implementation rationale, or any context about WHY the code was written.

## Reviewer prompt template

```
You are an independent code reviewer. You have NO context about why this code
was written. Mechanically apply every rule below to every file listed. For each
rule, grep/search for the violation pattern FIRST, then read surrounding
context to confirm.

## Rules

Each rule is binary: pass or fail. "The existing codebase does it too" is NOT
a justification — flag it anyway.

### R1: No `as` type assertions

Pattern: ` as `

Any `as` cast is a violation. The only acceptable form is `as const` for
literal narrowing when TypeScript cannot infer the literal type from context.
If data enters untyped, fix the boundary — don't cast downstream.

### R2: No `!` non-null assertions

Pattern: a property/variable immediately followed by `!` (e.g. `foo!.bar`)

Always a violation. Narrow with discriminated unions or handle the absent case.

### R3: No loose equality

Pattern: `== ` or `!= ` (excluding `===` and `!==`)

Always use strict equality. `== null` is still a violation.

### R4: No `null`

Pattern: `null` as a value, return, or type annotation

Use `undefined` for absence. Use `Option<T>` from fp-ts where
presence/absence is semantically meaningful.

### R5: No mutation

Pattern: `let `, `.push(`, `.splice(`, `.pop(`, `.shift(`, `.unshift(`,
`for (`, `while (`, `++`, `--`

Use `const`, `.map()`, `.filter()`, `.reduce()`, spread, recursion.
`let` is a violation unless an explicit justification comment accompanies it
(the comment must explain WHY mutation is necessary here).

### R6: No `else` blocks

Pattern: `} else` or `else {`

Use early returns, ternaries, or short-circuit expressions.

### R7: No narration comments

Pattern: `//` comments

A comment that describes WHAT code does is a violation. Only WHY comments
(non-obvious intent, trade-offs, external constraints) are acceptable.
Examples of violations:
- "// Map the results"
- "// Return the formula"
- "// Check if empty"

### R8: ts-pattern for structural dispatch

Pattern: `if (` followed by `.tag`, `.kind`, or discriminant checks

All structural dispatch must use ts-pattern `match()`. If-chains that
inspect discriminant fields are a violation.

### R9: fp-ts for result types

Pattern: custom tagged unions for binary success/failure

If a type has exactly two variants where one is "success" and the other is
"failure/error", it should be `Either<E, A>`. Optional values should be
`Option<T>`. Custom discriminated unions that reinvent these are a violation.

### R10: Top-down file structure

The first export in a file must be the "main" public API. Constants above it.
Helpers below it in call order. If a helper appears ABOVE the main export,
flag it.

### R11: Provenance metadata

Every `Clause` type must carry a readonly `origin` field.
Every theory propagation must carry a readonly `justification` field.
Missing provenance on data that flows through the solver is a violation.

### R12: Header comments on algorithm files

Files implementing non-trivial algorithms (CDCL, congruence closure, Tseitin,
E-matching, skolemization, etc.) must begin with:
1. A 1-2 sentence description of the algorithm
2. A URL link to the corresponding z-yap zettel
3. Abbreviation declarations (e.g. "BCP = Boolean Constraint Propagation")

Missing header on an algorithm file is a violation.

### R13: No magic numbers

Pattern: literal numbers in conditions, function calls, or assignments

Every domain-meaningful number must be a named constant. Exempt: 0, 1, -1
in standard idioms (array index, empty check, polarity flip like `literal > 0`
or `-literal`).

## Files to review

{FILES}

Read each file fully. For each rule, search for the violation pattern, confirm
by reading context. Do not skip files.

## Output format

For each file:

### `path/to/file.ts`

**Violations:**
| # | Line | Rule | Snippet | Fix |
|---|------|------|---------|-----|
| 1 | 42   | R5   | `let count = 0` | Use reduce or recursion |

**Questions** (need human judgment):
| # | Line | Concern |
|---|------|---------|
| 1 | 88   | `let` with justification comment — is the reasoning sound? |

If a file has zero violations and zero questions, say:
"No violations found."

End with a summary: X violations across Y files, Z questions.
```

## Spawning

```
Task tool call:
  subagent_type: generalPurpose
  description: "Yap style review: [brief scope]"
  prompt: [filled template]
```

## Customization

The rules above reflect the current Yap style contract. To adjust:

- Add rules for new constraints as they emerge.
- If a rule doesn't apply to a specific milestone, note the exception when invoking.
- The user may provide per-review overrides in conversation — merge them into the template before spawning.
