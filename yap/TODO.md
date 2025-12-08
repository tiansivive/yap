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

- Recursion
  - Fixpoint: `Y` abstraction for fn recursion
  - Recursive types: `mu` abstraction for equi-recursive types
  - Coinduction: `nu` abstraction
    - No type level distinction between infite and finite types
    - Only use for recursive **data** structures via `nu`.
    - Leverage `check`
      - When checking a variable against a mu type, wrap in a `nu` => means codata
- ~~Type level singleton String and Nums~~
  - ~~Adapt normalization to reduce string operations~~, ~~arithmetic and logical expressions~~
  - ~~rely on bidir for implementation~~
    - ~~infer `1` as `Num`. Check `1: 1` as well as `1: Type` and `1: Num`~~
    - ~~implications for interop with rows and indexed types?~~
- Fix sigma contexts (dependent records)
  - Must be a stack
  - Change `Sigma`s to introduce an actual `env` entry. Labels can implemented with deBruijn idx + label name.
    - eg: `Σsig: [foo: Num]. Schema I0 -| .`
    - Applying gives `sig: [foo: Num] |- Schema L0`
    - `:foo` would evaluate to `L0:foo` -> use normal deBruijn idx/lvl to find the correct var in the `env` and then `:lbl` to find the field in the row.
  - ~~unify evaluation and elaboration sigmas so we don't need the extract bindings trick in evaluation~~
- Delimited continuations
  - shift/reset
- Function domains modelled with Rows?
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
    - ~~Implementing CAS instead of SMT?~~
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
  - If/when we move to `Evaluation` monad, the wrapper to perform `eval` within `Elaboration` can/should be called `normalize`
- Store inferred types in elaborated terms
- Spineful applications?
  - Would help/prepare for Higher-Order unification
- Redo `row` based terms to proper constructors
  - Gets around all the hacks we have for pattern matching on Recursive/App/Mu/etc
- Testing
- Monads Monads Monads
  - ~~Debugging and stack tracing is hard~~ (No longer applicable after generator refactor)
  - Separate into `Evaluation`, `Verification`, `Inference`, `Unification`, etc monads
  - Add a mutable `State` monad component
- Refactor `EB.Context`
  - Remove `zonker` and `metas`.
    - These are an evolving record so should under a mutable State `MetaContext`
    - Will fix a lot of the hacks where metas/zonkers are propagated everywhere
- Introduce an IVL
  - Instead of directly building z3 expr, build an AST representing the formula
  - use smtlib2
  - Allows caching and serializing. Easier testing.
  - Portable across SMT backends
- Rework let binding "sequencing" (multiple decs in a block)
  - Recursion currently demands a lot of ctx entending in different places.
  - ~~Maybe better to have only a `fix` abstraction, perhpas unifying with `mu`.~~
- After switching to closures containing the whole Context, some functions are no longer dependent on it (eg, quoting). Clean up those params
  - It's probably not necessary to hold the whole context, we can perhaps keep just imports and env, and adjust Context utilities
  - This helps with the "Not Implemented" Errors in some scenarios handling closures
- Refactor row operations
  - rewrite
  - meet/join for pattern matching
  - Use a better data structure? Just a plain array?
- Modal terms
  - Associate only one modality? so usage + liquid would be `Modal Q Many (Modal L (\x -> x > 0) (Num))`

### Known issues

- Pattern matching doesnt narrow down types dependent on the scrutinee
  - Example:

  ```
    let process: (b: Bool) -> (v: match b | true -> Num | false -> String) -> String
      = \b -> \v -> match b
          | true  -> stringify v  // v: Num here
          | false -> v;           // v: String here
  ```

  - `v`'s type is a `StuckMatch` as when it is introduced, we don't know the **value** of `b`. Later, in the each match branch, we can narrow `b` down to `true` or `false` and progress with computing `typeof v`.
  - I think we need HM, GHC-style Implication constraints.
  - What are the implications for higher order unification if that ever gets built?

  - Example 2:

  ```
    let head: (n: Num) -> (a: Type) -> Vec (n + 1) a -> a
      = \n -> \a -> \vec -> match vec
          | { x, xs } -> x;
  ```

  - This currently emits the (failing) constraint: `Schema [ 0: ?1, 1: ?2 | ?3 ] ~~ (Vec) ($add: (L1) (1)) L2

  - **Possible implementation solution**
    - Add a different type of constraint: _Implication_. This will carry assumptions one can use to lookup values: `(b = true) ==> StuckMatch(L1) ~~ String`
    - When unifying `StuckMatch(L1) ~~ String`, we can safely lookup the value of the rigid L1 in the assumptions without breaking scoping (no rigid escape or similar).
    - If value is found, unblock the match and proceed with unification
    - If no value is found, leave the rigid as-is

    - for the `head` case:
      - emit:

      ```
        1. (($add L1 1) = k1, k1 ~~ 0)  ==> (StuckMatch(k1) = kk1, kk1 ~~ Unit)                                 ==> Schema [ 0: ?1, 1: ?2 | ?3 ] ~~ kk1
        2. (($add L1 1) = k2, k2 ~~ k3) ==> (StuckMatch(k2) = kk2, kk2 ~~ Schema [ 0: L2, 1: Vec (k3 - 1) L2 ]) ==> Schema [ 0: ?1, 1: ?2 | ?3 ] ~~ kk2
      ```

      - First antecendent is from the pattern match in the definition of `Vec`, the second is matching the tuple pattern in `head` against the result of of the first antededent
      - This would result in `1` failing due to `kk1 ~~ Unit` and `2` giving `?1 = L2, ?2 = Vec (($add L1 1) - 1) L2`
      - Not sure if this goes anywhere?

- Can't elide implicits before an explicit implicit application
  - Need to figure out how to match which implicit is being applied.
  - Named args might solve this issue
