### Syntax

- where clause
- infix fn application
- custom operators?
- allow unicode identifiers
  - mostly just `'`
- Multiple arguments
- Variadic arguments
  - Arity regex constraints
- Argument pattern matching
- `typeof` operator
- shorthand match expression
- Symbol for inferring in-scope implicit when no type is specified:
  - `let foo = fn $myImplicitArg` => `let foo: (myImplicitArg: ?0) => ?1 = fn $myImplicitArg
    ~~- Separate records/tuples syntax from indexed types and rows~~
  - ~~`{ foo: 1 }` => record~~
  - ~~`{ 1, "hello" } => string`~~
  - ~~`[1,2,3]` => Array Num, sugar for `[0: 1, 1: 2, 2: 3]`~~
  - ~~`[foo: "foo", bar: "bar"]` => Map Num String~~
  - ~~`[foo: String, bar: Num]` => Row, overloaded syntax is differentiated by checking the row term against `Type`~~
  - multimap?
  - table?
- Telescope?
  - ~~Allow `.foo.bar.baz` syntax~~
  - deep injections
- Indexing operator syntax `foo[0] || foo['bar']`
  - QUESTION: possibility of unifying rows and indexed types under 1 syntax and more generic/flexible type?
- Type operators for row manipulation
- SQL-like data traversal
- backcall
- loop/repeat for iteration

### Core Features

- ~~Type level singleton String and Nums~~
  - Adapt normalization to reduce string operations, ~~arithmetic and logical expressions~~
  - ~~rely on bidir for implementation~~
    - ~~infer `1` as `Num`. Check `1: 1` as well as `1: Type` and `1: Num`~~
    - ~~implications for interop with rows and indexed types?~~
- Fix sigma contexts (dependent records)
  - Must be a stack
- Delimited continuations
  - shift/reset
- Exclusion/Not type operator
  - `!Int` means any type that is not an `Int`
  - More useful concept for rows to model `Lacks` constraints
    - For effect rows, allows specifying "any effect excluding `X`": `() -> Int <!IO>
- Modalities
  - Usage semantics overhaul
    - Move to Verification step
    - FBIP: Functional but in-place
      - Linear vars allow mutating values
      - Still no re-binding!
      - Ref counting? Perceus?
  - ~~Refinements?~~
    - Implementing CAS instead of SMT?
    - Early VC check to discharge obligations
      - Better error reporting!
      - Needs moving each `letdec` to `async/await`
    - Counterexample reporting
      - Needs a formula translation overhaul
    - Termination metrics?
      - useful for loop/repeat syntax
  - Effect system
    - Consider pure vs side effects
    - built on top of shift/reset primitives
  - Coeffects?
  - Call semantics
    - strict/lazy
- Reflection
  - `Dynamic` type
  - Tag runtime values with their type
  - Could allow for untagged type unions/variants?
    - Inferring untagged unions means adding a `Reflect` constraint/implicit
- Debugging?
  - Source maps?

### Type inference

- Monomorphism restriction?
- Emit implicit resolution constraint
  - Fixes types not yet being fully solved (still metas) when looking up implicits
- Mutual recursion
  - multiple passes
  - module level constraint solving
- Cyclic dependencies
  - Check Discord?
  - Same issue as mutual recursion
  - QUESTION: Allow separate module definition files?
- Type Y combinator?
  - Full equi-recursive types (seen sets)
    - coinductive/bisimulation-based equality: Amadio & Cardelli (1993); Brandt & Henglein (POPL’98)
- First class polymorphism:
  - Andras Kovacs DOE
  - Higher order unification?
- Track mu-type unfoldings and fold them back for display purposes
- Modality polymorphism and inference
  - Refinement inference done in verification as per Jhala & Vazou
  - Multiplicity probably follows from QTT
  - Koka reference for Effects

### Lowering

- Type erasure
- Pattern matching implementations
  - Unification? Residuations?
    - Check curry lang and functional logic papers
- Indexed types implementation
  - Hashmap for dicts
  - Contiguous block for Array
- Row types implementation
  - Hashmap? vtable?
- Optimizations (inlining, eta/beta reduce, etc)

### Tooling

- LSP
- Syntax highlighter
- REPL

### Tech debt

- Use tree sitter instead of Nearley
- Normal forms
  - Create a wrapper that is more explicit about using WHNF while inferring
- Store inferred types in elaborated terms
- Spineful applications?
  - Would help/prepare for Higher-Order unification
- Testing
- Monads Monads Monads
  - ~~Debugging and stack tracing is hard~~ (No longer applicable after generator refactor)
  - Separate into `Evaluation`, `Verification`, `Inference`, `Unification`, etc monads
  - Add a mutable `State` monad component
- Refactor `EB.Context`
  - Remove `zonker` and `metas`.
    - These are an evolving record so should under a mutable State `MetaContext`
    - Will fix a lot of the hacks where metas/zonkers are propagated everywhere
- After switching to closures containing the whole Context, some functions are no longer dependent on it (eg, quoting). Clean up those params
  - It's probably not necessary to hold the whole context, we can perhaps keep just imports and env, and adjust Context utilities
  - This helps with the "Not Implemented" Errors in some scenarios handling closures
- Refactor row operations
  - rewrite
  - meet/join for pattern matching
