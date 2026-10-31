---
name: audit-comments
description: >-
  Audits the code comments added or changed in the Yap repository against the project's
  comment and prose rules (whether a comment should exist, who reads it, rhythm, tone,
  overblown conclusions, development residue, jargon, em dashes) by spawning an independent
  reviewer agent that proposes a rewrite for every failing comment. Use when the user asks for
  a comment audit or a review of comments or documentation, or when a plan step calls for one.
  Do not run it unprompted after an implementation.
---

# Comment audit

A comment written during development tends to carry the author's context: the plan step it came from, the example that was on screen, the conclusion that felt important at the time. The author cannot see that residue, so this skill gives the audit to a separate agent that has only the rules and the code.

The rules are the Comments section of `.cursor/rules/coding-style.mdc` and the "Audience, rhythm and tone" section of `.cursor/rules/communication.mdc`. The reviewer reads them directly.

## Procedure

1. **Scope.** Use the paths the user gave. Otherwise take the files changed against the base branch, including uncommitted work:
   ```bash
   git diff --name-only origin/main -- '*.ts'
   ```
   The audit covers comments added or changed in that diff, including doc comments.
2. **Fill the template** below with the file list and the base ref.
3. **Spawn** a `generalPurpose` subagent with the `Task` tool (description: `Comment audit: <scope>`), passing the filled template as the prompt. Do not add conversation history, plans, or any explanation of why a comment was written.
4. **Report** the reviewer's output verbatim, rewrites included. Applying the rewrites is a separate step that the user decides on.

If the user asks for it, the same procedure works for a commit message or a PR description. Pass the text instead of the file list and drop the question of whether the comment should exist.

## Reviewer prompt template

```
You are auditing code comments in the Yap repository. You know nothing about why the code or its comments were written. Judge each comment as a maintainer would meet it: next to the code, with no other context.

The standard is in these files. Read them fully first:
- The Comments section of .cursor/rules/coding-style.mdc
- The "Audience, rhythm and tone" section of .cursor/rules/communication.mdc

Files: {FILES}
Base ref: {BASE}. Find the comments added or changed with `git diff -U0 {BASE} -- <file>`, then read each one in its surrounding code.

For every added or changed comment, answer in order:
1. Should it exist? A comment earns its place by stating a reason or constraint that the code cannot show, or by flagging code that is knowingly not ideal. Narration of what the code does, a restated signature, the rationale for the change, and the history of how the code came about all fail this test.
2. Can the next maintainer follow it from the surrounding code alone? Flag references to plan steps, milestones, review requests, or examples and names that only the author would recognise.
3. How does it read? Flag clipped declarative beats and clauses chained with colons and semicolons, an overblown closing conclusion, several terms of art stacked in one sentence, em dashes, and length beyond a few sentences, which means the content belongs in a commit message or design note.

Output one entry per comment:

### path/to/file.ts:LINE
Verdict: keep | rewrite | delete
Problems: which of the checks above it fails, with the words that fail it
Rewrite: the replacement comment, or "delete". The rewrite must meet every rule itself: plain connected sentences, sized to the point, written for a reader without context.

Leave out comments that pass all three checks, and end with a count of keep, rewrite and delete verdicts.
```
