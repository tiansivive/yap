<h1 align="center">Yap</h1>

<p align="center">A small core lang with some extra fluff</p>

<p align="center">
	<!-- prettier-ignore-start -->
	<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
	<a href="#contributors" target="_blank"><img alt="👪 All Contributors: 2" src="https://img.shields.io/badge/%F0%9F%91%AA_all_contributors-2-21bb42.svg" /></a>
<!-- ALL-CONTRIBUTORS-BADGE:END -->
	<!-- prettier-ignore-end -->
	<a href="https://github.com/tiansivive/lama/blob/main/.github/CODE_OF_CONDUCT.md" target="_blank"><img alt="🤝 Code of Conduct: Kept" src="https://img.shields.io/badge/%F0%9F%A4%9D_code_of_conduct-kept-21bb42" /></a>
	<a href="https://codecov.io/gh/tiansivive/lama" target="_blank"><img alt="🧪 Coverage" src="https://img.shields.io/codecov/c/github/tiansivive/lama?label=%F0%9F%A7%AA%20coverage" /></a>
	<a href="https://github.com/tiansivive/lama/blob/main/LICENSE.md" target="_blank"><img alt="📝 License: MIT" src="https://img.shields.io/badge/%F0%9F%93%9D_license-MIT-21bb42.svg"></a>
	<img alt="💪 TypeScript: Strict" src="https://img.shields.io/badge/%F0%9F%92%AA_typescript-strict-21bb42.svg" />
</p>

# Yap

`Yap` is a programming language. It's mine. I built it. Why? Because I got annoyed with everything else. So instead of doing something productive, I went peak software bro and made my own.  
There's no grand vision here — just a bunch of features I like, without the stuff that sucks, keeping me from throwing my laptop out a window.

## What Even Is This?

A **dependently typed language** with **first-class, structural types**, **implicits**, and **zero runtime assumptions**. The idea is to keep the core **minimal**, let types do their thing (and then nuke them!), and **make everything customizable**.  
If you don’t like how something works, change it — preferably without rewriting the compiler.

It’s still early days, so expect **broken things, missing features, a nonsensical mess and half-baked ideas**. But hey, it already supports:

- **Type system goodies**
  - **Structural typing** - so you don’t have to fight a nominal type system for no reason
    - Dependent functions, Dependent Records, Variants, Recursive types
  - **Refinement types** - because Naturals, Ranges, non-empty lists and such exist even if we pretend they don't
  - **Type inference** - Momma always told me I had a short attention span
- **Implicits** - so you don’t have to pass a million arguments manually
- **Delimited continuations** - for when you make an oopsie and need control flow to pretend it was intended
- **Evaluator** - It does things like `1 + 2` and `(\x -> x + 1) 2`
- **Foreign function interface** - Just an excuse to write JS instead of actual yap code
- **Module system** - because you have a file system
- **JS codegen** - sue me (also, it's broken)

Check out the [examples](./examples/README.md) folder to get a more in depth overview of what is currently available. But for the TLDR crowd:

```ts
let Factorial: Type
    = { compute: Num -> Num };

let fact: Factorial
    = { compute: \n -> match n
        | 0 -> 1
        | _ -> n * (:compute (n - 1)) // :compute refers to the 'compute' field itself
    };

let result = fact.compute 5;  // 120
```

Yes, this is actual, working syntax! Ensue bikeshedding.

## Trying It Out

`Yap` isn’t quite "usable" yet unless you enjoy debugging the compiler. If you're a masochist though, you'll need some groundwork:

1. [Install `z3` ](https://github.com/Z3Prover/z3/releases)
   - On macOS, use `brew install z3` like a normal person
2. Clone the repo
3. Install `node`
   - Easiest [via `nvm`](https://github.com/nvm-sh/nvm). Either `nvm use` or `nvm install`
4. [Install `pnpm`](https://pnpm.io/installation)
5. `pnpm install`
6. `pnpm nearley` builds the parser

That wasn't so hard!
Now chop chop, fun part is coming

### Playing with the REPL

You know the drill:

1. `pnpm run yap repl`
2. Write some broken code
   - sacrifice a goat
   - pray it works
   - get mad when it breaks
3. Complain

The `examples/README` has a fairly good overview of what's currently supported, although I make no claims that anything outside of those carefully curated examples will work.

## My twisted worldview

`Yap` isn’t trying to revolutionize programming. It will just do things in a way that **makes sense to me**:

- **Minimal core** – Small enough that even I can remember how it works.
- **Sugar, spice and everything nice** - This isn't an academic toy; it should actually be **nice to use**.
- **Turing complete types** - I solemnly swear you can nuke the bastards at runtime.
- **No platform assumptions** – The compiler should let you generate whatever garbage output you want. No judging.
- **You’re in control** – Defaults exist, but if you don’t like them, override them. No gatekeeping.
- **Multi paradigm** - let the flame wars begin

### But who will use it?

Whomever fancies it. Yap isn’t aimed at “frontend people” or “systems people” or whatever other tribe the internet has invented this week.  
Most software is just trying to ship a product so it's for anyone who just wants normal, product-driven code without getting bogged down in platform-specific constraints.

See more in the [`FAQ`](./FAQ.md)

## The Plan

In case it wasn't obviours, this here is a work in progress (read: broken, just like my last relationship), so here's a list of things that still need to be done:

### Currently in the works

- Delimited continuations
  - It already supports basic shift/reset and type inference/checking
- Resource usage semantics
  - For those pesky mutations, references and IO handles

### Syntax goodies

- Variadic arguments, named arguments... (Yes, I like arguing)
- Infix function application (less parens = better)
- Better syntax sugar for common patterns (shorthand matches, destructuring, backcalls, pipes, etc.)
- `where` clauses (because who likes deep nesting?)
- Data traversal (nested updates, SQL-like goodies)

### Core Features

- Reflection (for runtime type-driven pattern matching)
- Recursive infinite data (Coinduction)
- Delimited continuations
  - Effect system on top
- Lowered IR
  - For annoying things like type erasure, monomorphization, FBIP optimizations, customizable data types, fusion, etc

### Tooling (This Is Important!)

- **Syntax highlighting** (so we can pretend it's a real language)
- **LSP support** (because writing a language without an LSP in 2025 is just rude)
- **A debugger** (because I am dumb)
- **A REPL** (technically it exists...)

### Things That Keep Me Up at Night

- **To Any or not to Any** – Do I really want to introduce the TypeScript plague into my pristine little ecosystem?
  - A gradual type system is a `Yay!` in my book, but also a can of worms
- **Effects** - Simultaneously the bane of all devs, but also the thing that keeps the world running
  - How to best allow for ergonomic effects?
  - I should be able to log stuff without having to change a bazillion files
  - Exclusive effects? Not like an exclusive/VIP club, you pleb! As in: allow all effects except for `X`.

### Things I’m Embarrassed About

`Yap` has some… let’s call them character-building aspects.

- **The `REPL`** - More like a suggestion than a real tool.
- **The `FFI`** - Functional in the same way a car with three wheels is technically functional.
- **The module system** - Yeah, it exists.
- **Testing** - because I keep breaking everything every other day
- **Comments** - I forgot, ok?
- **Tech debt** 💀
  - Well, **lowering** isn't a thing yet (but hey, at least it’s not _not_ a thing, right?)
  - The generator-monad-look-alike stuff... I wanted to be creative, k?

Improvements are coming, but for now, just squint and pretend everything is fine.

## Contributing

If you want to contribute, that’s cool! Open an issue, start a discussion, or throw a PR my way. I genuinely enjoy discussing ideas.  
I also suck at communication, so feel free to continue to pester me with notifications while I continue to ignore them. Such is life.

## What’s With the Name?

“Yap” stands for “Yet Another Problem.” Because, let’s be real, that’s exactly what this is. Another problem I’ve decided to create for myself instead of just, you know, using something that works.  
Could’ve called it “Just Another Language,” but then it wouldn’t have been as honest or as snarky. So here we are.

## Is this even possible?

I don't know, you're better off asking a CS PhD Nobel Laureate logician.  
Maybe it’s a terrible, and terribly flawed, idea. Maybe it’s genius. Maybe it’s just a complete dumpster fire wrapped in _my_ own personal code therapy session.

Could it ever be fully usable, safe, sound, fast, feature-rich and whatever else your shiny programming language needs to be? Probably not. Maybe it’ll never turn into something functional. **But do I like it**? Yeah, _I_ do. I think it’s cool.
If _you_ do too, cool. If you don’t, cool. Either way, it's here.

And it works... _kinda_.
