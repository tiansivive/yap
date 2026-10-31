---
name: audit-code
description: >-
  Audits TypeScript changes in the Yap repository against the project's written coding
  guidelines (coding-style, pattern-matching, conventions, testing and the lint contract) by
  spawning an independent reviewer agent that sees only the rules and the files. Use when the
  user asks for a code audit or style review, or when a plan step calls for one. Do not run it
  unprompted after an implementation. Comments and architecture have their own auditors
  (audit-comments, audit-architecture).
---

# Code audit

The agent that wrote the code knows why every line is there, and that knowledge makes it approve its own choices. This skill hands the audit to a separate agent that receives the guidelines and the files but nothing about the intent behind them.

The guidelines live in `.cursor/rules/`, and the reviewer reads them directly, so this skill never restates a rule. `yap-reviewer` is a different tool: it applies a fixed list of mechanical rules. Use this skill when the question is whether the code follows the project's current guidelines.

## Procedure

1. **Scope.** Use the paths the user gave. Otherwise take the TypeScript files changed against the base branch, including uncommitted work:
   ```bash
   git diff --name-only origin/main -- '*.ts'
   ```
   Leave out generated files (`src/parser/grammar.ts`) and snapshots.
2. **Fill the template** below with the file list and the base ref.
3. **Spawn** a `generalPurpose` subagent with the `Task` tool (description: `Code audit: <scope>`), passing the filled template as the prompt. Do not add conversation history, plans, design notes, or any explanation of why the code was written.
4. **Report** the reviewer's output verbatim. Do not filter, soften or pre-empt findings. Fixing them is a separate step that the user decides on.

## Reviewer prompt template

```
You are auditing TypeScript code in the Yap repository against its written guidelines. You know nothing about why this code was written, and you should not infer intent to excuse a violation.

The standard is in these files. Read them fully before looking at any code:
- .cursor/rules/coding-style.mdc (skip its Comments section; comments are audited separately)
- .cursor/rules/pattern-matching.mdc
- .cursor/rules/conventions.mdc
- .cursor/rules/testing.mdc, for test files only

Files to audit:
{FILES}

Base ref for the changes: {BASE}. Run `git diff {BASE} -- <file>` to see what changed. Report findings on changed lines; read whole files for context.

Method:
1. For each rule, search the files for its usual violation patterns, then read the surrounding code to confirm each hit. Typical patterns include `if (` dispatching on a discriminant such as `.type` or `.kind`, inline object patterns in `.with(` where a pattern object exists, `P.when` inside pattern objects, predicate helpers named `isX(`, `as` casts, `Extract<NF.Value`, `let`, `for (` and `while (` outside the sanctioned mutable cores listed in coding-style.mdc, multi-word function names, and long fp-ts pipelines.
2. Read each file from top to bottom for the structural rules: the main subject first, types next to the code that uses them, single-caller helpers inlined, no echo types, namespace-based APIs, composition instead of intermediate variables that add no meaning.
3. "The surrounding code does it too" is not a justification. Unchanged lines with problems go in a separate pre-existing list, without fixes.

Output, for each file:

### path/to/file.ts
| Line | Rule (file > section) | Evidence | Fix |
|------|------------------------|----------|-----|

Questions that need human judgement go in a second table with the line and the concern. A file without findings gets "No findings."

Finish with the pre-existing list, then a count of findings and questions.
```
