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

## Stop dodging!

Fine! There's an FFI. You wanna do C pointers? expose a wrapper in C, link the C file, describe and define the type and value/constructor in Yap. Boom. Nice doing business with you.
Just know, you've now introduced all that impurity into my tiny core so be sure to type things appropriately!

## What’s the roadmap?

There is none. There are intentions.

### Coming soon

- Multiplicities for mutation, references and other such unimportant things like IO
- Treesitter Parser migration

### Coming eventually (real intentions)

- Better error reporting throughout the compiler pipeline
- LSP
- Proper module system
- Type erasure
- Coinductivity
- Packages

### Maybe someday, maybe never

- Effect system
- Refinement inference
- Termination metrics
- Dependent pattern matching
- Gradual/dynamic boundaries

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

## Flow's too wet, Control move it!

Sometimes control flow should leave, come back, leave again, apologize badly, and then somehow still have opinions about the rest of the program, like a toxic relationship. Because we're masochists, in programming languages we call it a feature.
Yap has delimited continuations: `reset`, `shift`, and `resume`. `reset` draws a boundary around a computation, `shift` captures the rest of that computation up to the nearest `reset`, `resume` jumps back into that captured computation.

If the `shift` body returns a value directly, it behaves a lot like an early exit:

```ts
let checkedDivide: Num -> Num -> Num
    = \x y -> reset ({
        let divisor = match y
            | 0 -> shift 0
            | _ -> y;
        return x / divisor;
    });
```

When `y` is `0`, `shift 0` skips the remaining computation inside the `reset` and the whole `reset` produces `0`. This is the exception-shaped part: you leave and ghost your partner. Rude.

The emotionally available versions use `resume`

```ts
let recovered: Num
    = reset ({
        let x = shift (resume 10);
        return x + 1;
    });
```

The captured continuation is essentially `\x -> x + 1`. Calling `resume 10` continues the computation as if `x` had been `10`, so the result is `11`.
But Yap is freaky and supports multishot resumptions; you can technically resume multiple relationships:

```ts
let many: Num
    = reset ({
        let x = shift ((resume 1) + (resume 2));
        return x * 10;
    });
```

Here the captured continuation is `\x -> x * 10`. Resuming with `1` gives `10`; resuming with `2` gives `20`; the shift body adds them and the result is `30`. Not advisable in real life... trust me?

Underneath, Yap lowers this to ordinary blocks, jumps, captured environments, and branch dispatch. It's all good, don't worry about it.

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
3. Lower the resulting obligation into Yap’s IVL (Intermediate Verification Language)
4. Ask the custom SMT solver pipeline whether the VC (verification condition) is valid.
5. The solver runs a CDCL-style Boolean core with theory reasoning attached:

- **EUF** handles equality and uninterpreted functions.
- **Arithmetic** handles numeric constraints.
- **Quantifier handling** deals with universally quantified obligations

### Validity

**Validity** means the VC holds for every allowed case.
A VC like `forall x. x = 1 => x > 0` must hold for every possible value of `x`. In this case, it does: whenever `x = 1`, it follows that `x > 0`.
SMT solvers check satisfiability: whether at least one model exists for a formula. Refinement verification needs validity, so Yap negates the VC and checks whether that negation is unsatisfiable. If no counterexample exists, the original VC holds.
If words like SMT, VC, CDCL, Liquid Types, or “why is validity not satisfiability” sound like cursed alphabet soup, then you're a happy person. Please remain so.
The short version is: Yap turns refinements into logic problems and asks a solver to find holes in them.
However, if you've ever wondered what sadness and exasperation are, go read about [Liquid Types](https://dl.acm.org/doi/10.1145/1375581.1375602), [SMT solving](https://z3prover.github.io/papers/programmingz3.html), [verification conditions](https://arxiv.org/abs/2010.07763), and [CDCL(T)](http://www.math.tau.ac.il/~maon/teaching/2017-2018/seminar-sem-B/jacm06.pdf).

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

`pnpm yap repl` is your sacred artefact. Once launched run `:help`.

## So there's a runtime?

Oh hell naww! `Yap` will (probably) never ship a runtime.  
It doesn’t assume anything about memory layouts or platforms. You should (eventually) be able to compile this mess to JavaScript, Erlang, Lua, C, Assembly, Brainf\*ck (you demented sicko) or whatever else strokes your ego, without fighting the compiler. `Yap` will provide the required API to soothe your sweet soul, but _you_ will implement it, not `Yap`. Leave _me_ out of it.

## What about compiling code?

I wouldn't bother unless you're happy to debug IRs. It's very must WIP.
The easiest way is to `pnpm yap explorer`. This starts up a server on `localhost:3333` with an editor-like interface. Write yap code on the left, see the various IRs on the right. Get mind-blown!

There's 3 current (test) codegens: JS, Erlang and C. C links up a small, dumb, inefficient runtime - but hey, it works! But it is a runtime, which, by the law above, I will progressively nuke.

Technically `pnpm yap` is the compile command. Run it with `--help` to see options. But you've been warned - not much love has gone into that flow yet.

## What's the point then?

Are you the Inquisitor?  
The JS codegen is there to experiment and guide what the frontend should be doing. The C codegen is there to guide how to model or represent low-level peculiarities. The Erlang codegen is there... cuz i like it, k? Also, it's sufficiently different to stress test this mess. In any case, they aren't meant to be final, and it's unclear if yap will ship any codegen.

I'm spending an ungodly amount of time ironing out the kinks of what I'd like the (typing) semantics to be, so they're general/flexible/abstract enough to then translate to whatever platform floats your boat.

## Is the project alive?

As alive as I am. If I lose interest tomorrow, it dies. If I get obsessed for a month, everything changes. That’s the deal. It's happened before.
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
