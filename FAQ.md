# Yap FAQ

Welcome to the part where I pretend any of this was planned.  
This is a grab‑bag of answers to questions people might ask about Yap (or that I keep asking myself at 3am).

## What is this?

Yap is a small, aggressively opinionated, occasionally explosive dependently typed core language. It exists because I wanted it to.
At this point though, it's a playground for fun shenanigans. If you expected stability, marketing tone, or a roadmap with Gantt charts, you’re in the wrong cult.

## What Yap is _not_

- A proof assistant
- A Haskell clone, a Rust competitor, or an FP monument.
- Interested in pleasing enterprise committees.
- A revelation from the heavens
- An academic toy

Yap exists to be tiny, sharp-edged, and free of architectural guilt.

## What Yap _is_ trying to be

**Predictable**. Not boring-predictable — _mechanically_ predictable:
You write a thing, the compiler does mostly obvious, boring transformations, and you can see how everything hooks together.
If you want clever optimizations or fancy runtimes, you build or plug those in yourself. Yap gives you the knobs, not a pre‑blessed universe.

You should be able to look at a Yap program and know:

- exactly what’s evaluated,
- when it’s evaluated,
- where effects occur,
- how types restrict behavior,
- and what the core elaborates to.

No magic phases, no hidden laziness, no spooky action at a distance.

## What’s the roadmap?

There is none. There are intentions.

### Coming soon

- Multiplicities for mutation, references and other such unimportant things like IO
- Delimited continuations (because they’re absurdly powerful and fun).
- Better error reporting from the verifier: counterexamples and unsat cores

### Coming eventually (real intentions)

- LSP
- Proper module system
- A proper IVL to structure evaluation and verification.
- Coinductivity
- Type erasure
- C Codegen
- Packages

### Maybe someday, maybe never

- Effect system
- Refinement inference
- Termination metrics
- Dependent pattern matching
- A custom solver to replace the current Z3 duct tape.

### Never happening

- "Rewriting the world" status
- Corporate stability polish

There's a `TODO.md` file with a lot of notes and sketches. Take it with a grain of salt, but it lets you know where my mind travels.

## Effects in Yap

I like effects. I do **not** like baroque 40-year towers of monad transformer plumbing.

Effects in Yap aim to be:

- straightforward,
- explicit,
- predictable,
- minimal ceremony.

A sane effect system lets you print to the console without doing religious rituals.
If you want `IO` via twenty typeclass layers, the Haskell ecosystem is thriving.

## Quick dependent types crash course

Yap has full-spectrum dependent types: types can depend on values, and values can appear inside types. This is powerful, dangerous, and extremely fun.

You can express things like:

- vectors indexed by their length,
- functions that only accept non-empty structures,
- proofs that computations behave as intended.

Yap’s design keeps this power while keeping the core small enough that you can actually understand it. Sometimes this means you can break the typechecker.  
Learn and let live.

## This thing called refinements?

I think refinements are **extremely** useful. I also think they’re an entire extra compiler bolted onto your compiler.  
That might warrant nuking them, especially if the interactions with upcoming features become too complicated.

In Yap, a refinement is basically a predicate `a -> Bool` wrapped around a base type, plus machinery to:

1. Type‑check the predicate itself.
2. Normalize it via NbE when possible.
3. Translate the resulting condition into SMT land.
4. Using Z3 to check satisfiability

## Here be dragons

Yap uses normalization-by-evaluation. It’s elegant and fast — _in theory_. Right now, it’s also an easy way to summon demons.

The rough edges:

- If you run effects during NbE, Yap will happily sprint into traffic
- The evaluator assumes purity like a golden retriever assuming every human loves it
- The verifier is "fine" as long as you don’t ask hard questions
- The system might detonate at any point due to reasons

These are known issues. They will be addressed once the IVL exists. Until then: do not rely on verification or effects behaving gracefully inside normalization.

## Should you use Yap for anything important?

Absolutely not.
Unless your definition of "important" includes "I want to learn type theory by burning my eyebrows off." In that case, yes.

## But can I use it?

Yes! Please do!

## How do I use it?

`pnpm run repl` is your sacred artefact. Once launched run `:help`.

## Is the project alive?

As alive as I am. If I lose interest tomorrow, it dies. If I get obsessed for a month, everything changes. That’s the deal.
If you need guarantees, use Elm.

## Why does the FAQ feel chaotic?

Because it is. You’re welcome.

## Why the tone?

Because corporate has sucked the soul out of me. This is what's left.
This project is for humans who still enjoy messy creativity. If the tone feels chaotic, irreverent, or outright unhinged, good — it’s supposed to.

## Final note

This FAQ isn’t here to reassure you. It’s here to set expectations: Yap is experimental, sharp-edged, and intentionally chaotic — but now the chaos is structured.  
If that excites you, welcome. If you want safety and guarantees, use something else.
