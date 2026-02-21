# Known Documentation Issues

> Tracked issues where documentation has drifted from the actual codebase. Fix these when touching the relevant files or during a docs cleanup session.

---

## README.md

- [ ] Badge/repo links point to `tiansivive/lama` (old repo name) — should reference `yap`
- [ ] No link to `docs/ARCHITECTURE.md` for contributors
- [ ] Setup instructions say `npm install` — should be `pnpm install`
- [ ] "Delimited continuations" listed under "Currently in the works" — already implemented (inference, checking, tests pass)
- [ ] "Resource usage semantics" listed under "Currently in the works" — currently deprecated/outdated
- [ ] "Comments — I forgot" in "Things I'm Embarrassed About" — `#` comments work (tree-sitter grammar supports them)
- [ ] "JS codegen — broken" — codegen works; integration tests pass through REPL
- [ ] No mention of tree-sitter migration — only references Nearley

## examples/README.md (Language Tour)

- [ ] "What's Next?" section lists "Delimited continuations" as upcoming — already implemented
- [ ] No shift/reset section in the tour despite feature being implemented + example file existing
- [ ] File references at bottom (`yap/lib.yap`, `yap/main.yap`, `yap/liquids.yap`) point to `brainstorming/yap/`, not `examples/` — misleading paths
- [ ] `chess.yap` exists in `examples/` but is never mentioned or referenced
- [ ] Any changes to code snippets must stay in sync with `src/__tests__/integration/examples-readme.repl.test.ts`

## FAQ.md

- [ ] "Delimited continuations" listed under "Coming soon" — already implemented
- [ ] "Multiplicities for mutation, references" listed under "Coming soon" — currently deprecated
