<h1 align="center">Yap</h1>

<p align="center">A small TT core lang with some extra fluff</p>

<p align="center">
	<!-- prettier-ignore-start -->
	<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
	<a href="#contributors" target="_blank"><img alt="👪 All Contributors: 2" src="https://img.shields.io/badge/%F0%9F%91%AA_all_contributors-2-21bb42.svg" /></a>
<!-- ALL-CONTRIBUTORS-BADGE:END -->
	<!-- prettier-ignore-end -->
	<a href="https://github.com/tiansivive/lama/blob/main/.github/CODE_OF_CONDUCT.md" target="_blank"><img alt="🤝 Code of Conduct: Kept" src="https://img.shields.io/badge/%F0%9F%A4%9D_code_of_conduct-kept-21bb42" /></a>
	<a href="https://codecov.io/gh/tiansivive/lama" target="_blank"><img alt="🧪 Coverage" src="https://img.shields.io/codecov/c/github/tiansivive/lama?label=%F0%9F%A7%AA%20coverage" /></a>
	<a href="https://github.com/tiansivive/lama/blob/main/LICENSE.md" target="_blank"><img alt="📝 License: MIT" src="https://img.shields.io/badge/%F0%9F%93%9D_license-MIT-21bb42.svg"></a>
	<a href="http://npmjs.com/package/lama"><img alt="📦 npm version" src="https://img.shields.io/npm/v/lama?color=21bb42&label=%F0%9F%93%A6%20npm" /></a>
	<img alt="💪 TypeScript: Strict" src="https://img.shields.io/badge/%F0%9F%92%AA_typescript-strict-21bb42.svg" />
</p>

# Yap

`Yap` is a programming language. It's mine. I built it. Why? Because I got annoyed with everything else. So instead of doing something productive, I went peak software bro and made my own.  
There's no grand vision here — just a bunch of features I like, without the stuff that sucks, keeping me from throwing my laptop out a window.

## What Even Is This?

`Yap` is a **dependently typed language** with **first-class, structural types**, **implicits**, and **zero runtime assumptions**. The idea is to keep the core **minimal**, let types do their thing (and then nuke them!), and **make everything customizable**. If you don’t like how something works, change it — preferably without rewriting the compiler.

It’s still early days, so expect **broken things, missing features, a nonsensical mess and half-baked ideas**. But hey, it already supports:

- **Structural typing** - so you don’t have to fight a nominal type system for no reason
  - Dependent functions, Dependent Records, Variants, Recursive types (Ouroborous style!)
- **Type inference** - Momma always told me I had a short attention span
- **Implicits** - so you don’t have to pass a million arguments manually
- **Module System** - because you have a file system
- **Customizable data structures** - want to swap out how records/tuples work? Go for it, I don't care
- **JS codegen** - sue me

## Philosophy (Or Lack Thereof)

`Yap` isn’t trying to revolutionize programming. It just does things in a way that **makes sense to me**:

- **Minimal core** – Small enough that even I can remember how it works.
- **Sugar, spice and everything nice** - This isn't an academic toy; it should actually be **nice to use**.
- **Turing complete types** - They're first-class, but I solemnly swear you can nuke the bastards at runtime.
- **No platform assumptions** – The compiler should let you generate whatever garbage output you want. No judging.
- **You’re in control** – Defaults exist, but if you don’t like them, override them. No gatekeeping.
- **Multi paradigm** - let the flame wars begin

`Yap` will never ship a runtime.  
It doesn’t assume anything about memory layouts or platforms. You should (eventually) be able to compile this mess to JavaScript, Erlang, Lua, C, Assembly, Brainf\*ck (you demented sicko) or whatever else strokes your ego, without fighting the compiler. `Yap` will provide the required API to soothe your sweet soul, but _you_ will implement it, not `Yap`. Leave _me_ out of it.

Why? Because backends are hard. _Really_ hard. And I'm dumb, _really_ dumb.
There's heaps of incredible runtime platforms out in the wild, and hordes of people who actually enjoy dealing with platform-specific stuff — and they’re way better at it than I ever could be. So be free! I'll make sure to deal with those nasty fundamental concepts like mutation and references at the type level, and leave it all nice and pretty with sugar on top.
How you map that to your platform? That’s on you. You’re welcome.
I’ll be over here, having an existential crisis about types.

## The Plan (A.K.A. The Roadmap)

`Yap` is a work in progress (read: broken, just like my last relationship), so here's a list of things that still need to be done:

### 📝 Syntax

- Auto implicit expansion (because it's obvious)
- Infix function application (less parens = better)
- Variadic arguments, multiple arguments, named arguments... (Yes, I like arguing)
- Better syntax sugar for common patterns (shorthand matches, destructuring, backcalls, etc.)
- `where` clauses (because who likes deep nesting?)
- Data traversal (telescopes, SQL-like goodies, pipes)

### 🔥 Features

- Type modalities (mutability, effects, ownership, etc., without hardcoding magic into the compiler)
  - If this sounds like wishful thinking, well... it is! but I'm still gonna fail at it, because YOLO.
- Singleton types for `String` and `Num` (so the compiler actually knows what `1` is)
- Reflection (for runtime type-driven pattern matching)

### 🛠️ Tooling (This Is Important!)

- **Syntax highlighting** (so we can pretend it's a real language)
- **LSP support** (because writing a language without an LSP in 2025 is just rude)
- **A debugger** (because I am dumb)
- **A REPL** (because I want one, and debugging without one sucks)

### Things That Keep Me Up at Night

- **To Any or not to Any** – Do I really want to introduce the TypeScript plague into my pristine little ecosystem?

### Things I’m Embarrassed About

`Yap` has some… let’s call them character-building aspects.

- **The module system** - it's so embarrassing even ChatGPT could do better.
- **The `FFI`** - Functional in the same way a car with three wheels is technically functional.
- **The `REPL`?** - More like a suggestion than a real tool.
- **The `CLI`** - Yeah, it exists.
- **Testing** - because I keep breaking everything every other day
- **Comments** - I forgot, ok?
- **Tech debt** 💀
  - Well, **lowering** isn't a thing yet (but hey, at least it’s not _not_ a thing, right?)

Improvements are coming, but for now, just squint and pretend everything is fine.

## Trying It Out

`Yap` isn’t quite "usable" yet unless you enjoy debugging the compiler. At most you can generate some JS, scream in despair, load it up in `node` and then break your computer because you're coding in JS.
But if you're curious, check out the code, mess around with it, and maybe even contribute if you're brave.

1. Clone the repo
2. Build the compiler
   - You know the drill: `npm install`, `npm link`, `npm run stuff`, sacrifice a goat, etc.
3. Write some broken code
4. Complain

## Contributing

If you want to contribute, that’s cool! Open an issue, start a discussion, or throw a PR my way. I genuinely enjoy discussing ideas.  
I also suck at communication, so feel free to continue to pester me with notifications while I continue to ignore them. Such is life.

---

## What’s With the Name?

“Yap” stands for “Yet Another Problem.” Because, let’s be real, that’s exactly what this is. Another problem I’ve decided to create for myself instead of just, you know, using something that works.
Could’ve called it “Just Another Language,” but then it wouldn’t have been as honest or as snarky. So here we are.

## TypeScript? You're not serious

I love `Haskell`; it drove me mad.
I enjoy `Rust` and `I<Maybe<Box<Dynamic<&Result<Trait<🤯>>>>>>`
I will never write `Java`
I am too young for `C/C++`
I believe `Python` is a snake species
I don't know `OCaml`.
I fall asleep writing `Go`

I like building broken code, I like being able to debug, I like iterating, and I work with `TS` every day these days.
Sue me.

## Is this even possible?

I don't know, you're better off asking a CS PhD Nobel Laureate logician.
Maybe it’s a terrible, and terribly flawed, idea. Maybe it’s genius. Maybe it’s just a complete dumpster fire wrapped in _my_ own personal code therapy session.

Could it ever be fully usable, safe, sound, fast, feature-rich and whatever else your shiny programming language needs to be? Probably not. Maybe it’ll never turn into something functional. **But do I like it**? Yeah, _I_ do. I think it’s cool.
If _you_ do too, cool. If you don’t, cool. Either way, it's here.

And it works... _kinda_.

## Contributors

<!-- spellchecker: disable -->
<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="http://www.joshuakgoldberg.com/"><img src="https://avatars.githubusercontent.com/u/3335181?v=4?s=100" width="100px;" alt="Josh Goldberg ✨"/><br /><sub><b>Josh Goldberg ✨</b></sub></a><br /><a href="#tool-JoshuaKGoldberg" title="Tools">🔧</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/tiansivive"><img src="https://avatars.githubusercontent.com/u/2423976?v=4?s=100" width="100px;" alt="Tiago Vila Verde"/><br /><sub><b>Tiago Vila Verde</b></sub></a><br /><a href="https://github.com/tiansivive/lama/commits?author=tiansivive" title="Code">💻</a> <a href="#content-tiansivive" title="Content">🖋</a> <a href="https://github.com/tiansivive/lama/commits?author=tiansivive" title="Documentation">📖</a> <a href="#ideas-tiansivive" title="Ideas, Planning, & Feedback">🤔</a> <a href="#infra-tiansivive" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a> <a href="#maintenance-tiansivive" title="Maintenance">🚧</a> <a href="#projectManagement-tiansivive" title="Project Management">📆</a> <a href="#tool-tiansivive" title="Tools">🔧</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->
<!-- spellchecker: enable -->

<!-- You can remove this notice if you don't want it 🙂 no worries! -->

> 💙 This package was templated with [`create-typescript-app`](https://github.com/JoshuaKGoldberg/create-typescript-app).
