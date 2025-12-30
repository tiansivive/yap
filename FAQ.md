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

## Current status

See [`examples/README`](./examples/README.md) for a carefully curated list of what's doable today.  
If you intend on exploring, be warned that the typechecker and evaluator are (very) likely buggy.

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

## Seems like your just lazy?

And dumb, don't forget dumb! Backend platforms are hard, _really_ hard. My puny brain can't handle it, nor does it get dopamine from it.  
But fear not: there's heaps of incredible runtime platforms out in the wild, and hordes of people who actually enjoy dealing with platform-specific stuff — and they’re way better at it than I ever could be. So be free!  
I'll make sure to deal with those nasty fundamental concepts like mutation and references at the type level, and leave it all nice and pretty with sugar on top.  
How you map that to your platform? That’s on you. You’re welcome.

## So I just pretend the platform isn't real?

That's unhealthy! If you want to dive down into refs, ptrs, mem allocations and other gremlins, by all means, you should have that power!
Think of the platform as just another library: something you can ignore until you really need refs, ptrs and mem allocations.

In any case, Yap ain't there yet. These are just my wild fantasies.

## What’s the roadmap?

There is none. There are intentions.

### Coming soon

- Delimited continuations (because they’re absurdly powerful and fun).
- Multiplicities for mutation, references and other such unimportant things like IO

### Coming eventually (real intentions)

- LSP
- A proper IVL to structure verification.
- Better error reporting from the verifier: counterexamples and unsat cores
- Coinductivity
- Proper module system
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

I _like_ effect systems. I also like being able to do:

```
foreign print: String -> Unit;

let debug = \x -> {
  print (stringify x);
  return x;
};
```

without summoning a dozen type constructors.  
A sane effect system should let you print to the console without doing religious rituals. Consequently, I'm leaning heavily on relying purely on `shift/reset` and letting the good folks in library land deal with it. Power to the people!

## Quick dependent types crash course

Yap has full-spectrum dependent types: types can depend on values, and values can appear inside types. This is powerful, dangerous, and extremely fun.

You can express things like:

- vectors indexed by their length,
- functions that only accept non-empty structures,
- proofs that computations behave as intended.

Yap’s design attempts to keep this power but focuses more on practical programming than proofs. Sometimes this means you can break the typechecker.  
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

These are known issues. They will be addressed eventually. Until then: do not rely on effects behaving gracefully inside normalization.

## Should I use Yap for anything important?

Absolutely not.
Unless your definition of "important" includes "I want to learn type theory by burning my eyebrows off." In that case, yes.

## But can I use it?

Yes! Please do!

## How do I use it?

`pnpm run repl` is your sacred artefact. Once launched run `:help`.

## So there's a runtime?

Oh hell naww! `Yap` will (probably) never ship a runtime.  
It doesn’t assume anything about memory layouts or platforms. You should (eventually) be able to compile this mess to JavaScript, Erlang, Lua, C, Assembly, Brainf\*ck (you demented sicko) or whatever else strokes your ego, without fighting the compiler. `Yap` will provide the required API to soothe your sweet soul, but _you_ will implement it, not `Yap`. Leave _me_ out of it.

## What about compiling code?

I woulnd't bother.  
There's a very broken, outdated (read: ignored), mess of a JS codegen. At most you can generate some JS, scream in despair, load it up in `node` and then break your computer because you're coding in JS.

Try it out with

```
pnpm run yap <path_to_file>
```

Output will go to `bin/`.

## What's the point then?

Are you the Inquisitor?  
The JS codegen is there to experiment and guide what the frontend should be doing.  
I'm spending an ungodly amount of time ironing out the kinks of what I'd like the (typing) semantics to be, so they're general/flexible/abstract enough to then translate to whatever platform floats your boat.

## Is the project alive?

As alive as I am. If I lose interest tomorrow, it dies. If I get obsessed for a month, everything changes. That’s the deal.
If you need guarantees, use Elm.

## TypeScript? You're not serious

I love `Haskell`; it drove me mad.  
I enjoy `Rust` and `I<Maybe<Box<Dynamic<&Result<Trait<🤯>>>>>>`.  
I will never write `Java`.  
I am too young for `C/C++`.  
I believe `Python` is a snake species.  
I don't know `OCaml`.  
I fall asleep writing `Go`.

I like building broken code, I like being able to debug, I like iterating, and I work with `TS` every day these days.

## Why does the FAQ feel chaotic?

Because it is. You’re welcome.

## Why the tone?

Because corporate has sucked the soul out of me. This is what's left.
This project is for humans who still enjoy messy creativity. If the tone feels chaotic, irreverent, or outright unhinged, good — it’s supposed to.

## Final note

This FAQ isn’t here to reassure you. It’s here to set expectations: Yap is experimental, sharp-edged, fun, and intentionally chaotic — but now the chaos is structured.  
If that excites you, welcome. If you want safety and guarantees, use something else.
