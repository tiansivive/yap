---
name: audit-architecture
description: >-
  Audits a change in the Yap repository at the level of architecture: layering and module
  boundaries, growth of public APIs, duplicated mechanisms, order-dependent dispatch, use of
  deprecated surfaces, scope, and agreement with the decisions recorded in z-yap. Spawns an
  independent reviewer agent that sees the diff, the project's architecture documents and the
  relevant z-yap records, but not the conversation that produced the change. Use when the user
  asks for an architecture or design review of a change, or when a plan step calls for one. Do
  not run it unprompted after an implementation.
---

# Architecture audit

Line-level guidelines do not catch a change that leaks one layer into another, adds a second way of doing something the codebase already does, or quietly departs from a recorded decision. This skill asks a separate agent to judge the change against the project's architecture and its design records, without the author's reasons for each choice.

What runs is described by the code; why it is shaped that way, and what has been decided, is recorded in `z-yap/`. The reviewer treats a disagreement between them as a finding to report, not something to resolve.

## Procedure

1. **Scope.** Use the change the user names. Otherwise take the branch against its base, including uncommitted work:
   ```bash
   git diff --stat origin/main
   ```
2. **Fill the template** below with the base ref. Replace `{FOCUS}` with the area the user asked about, or delete it.
3. **Spawn** a `generalPurpose` subagent with the `Task` tool (description: `Architecture audit: <scope>`), passing the filled template as the prompt. Do not add conversation history, plans written for this change, or explanations of why it was made. The reviewer finds the relevant design records itself.
4. **Report** the reviewer's output verbatim. Decisions about the findings, and any updates to z-yap, are for the user.

## Reviewer prompt template

```
You are auditing a change to the Yap repository at the level of architecture. You know nothing about why the change was made. Judge it against the project's documented architecture and its recorded decisions.

Read first:
- AGENTS.md, for the pipeline and how knowledge is organised
- .cursor/rules/conventions.mdc, for layer names, key locations and the elaboration architecture
- The "Elaboration effects" and "Lint contract" sections of .cursor/rules/coding-style.mdc
- z-yap/init.md, for how to navigate the design records

The change: `git diff {BASE}`, with `git diff --stat {BASE}` for an overview. {FOCUS}

For every module the change touches, find the design records that govern it before judging: `node z-yap/scripts/catalog.js --search <topic>`, `node z-yap/scripts/adrs.js`, and `node z-yap/scripts/neighborhood.js <slug>`. ADRs and zettels tagged as decisions are the record of what was decided and why.

Check:
1. Layering. Source AST, core terms, NF values, GRAM and MIR are separate layers. Look for a module reaching into another layer's internals, NbE machinery used outside normalization, machine actions in the elaboration effect row, or metacontext state mixed into the lexical context.
2. Public surfaces. For each new export or entry point, ask whether it is needed, whether it overlaps an existing one, whether it exposes internal mechanics, and whether its name collides with existing terminology.
3. One mechanism per job. Search for existing helpers or abstractions that already do what a new one does, and for parallel code paths that make the same decision in two places.
4. Dispatch. Flag correctness that depends on the order of match clauses where a disjoint dispatch is available, either through patterns or through a status classification such as `view`.
5. Deprecated surfaces. Flag new uses of what conventions.mdc or the code marks as deprecated or legacy, for example `unwrapNeutral`, the V1 and `V2.Do` runtimes, or the usage vectors threaded through elaboration.
6. Decisions. Flag where the change contradicts or silently extends an ADR or design zettel, and where the code now disagrees with what a zettel describes.
7. Mutation outside the sanctioned mutable cores listed in coding-style.mdc.
8. Scope. Flag a change that does more than one thing, and effects on downstream stages (verification, GRAM, MIR, code generation) that the change does not make visible.

Output:

## Findings
Group them as "breaks a layer or a recorded decision", "weakens the structure" and "worth discussing". For each, give the location, the principle or record it concerns (with the zettel or ADR slug), the evidence, and a suggested direction rather than a patch.

## Records to update
Zettels or ADRs that this change makes inaccurate, each with what no longer holds.

## Questions
Points that need the author's judgement.
```
