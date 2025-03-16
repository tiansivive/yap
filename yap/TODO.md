### Syntax

- where clause
- infix fn application
- custom operators?
- allow unicode identifiers
  - mostly just `'`
- Multiple arguments
- Variadic arguments
- Argument pattern matching
- shorthand match expression
- Symbol for inferring in-scope implicit when no type is specified:
  - `let foo = fn $myImplicitArg` => `let foo: (myImplicitArg: ?0) => ?1 = fn $myImplicitArg
- Separate records/tuples syntax from indexed types and rows
  - `{ foo: 1 }` => record
  - `{ 1, "hello" } => string
  - `[1,2,3]` => Array Num, sugar for `[0: 1, 1: 2, 2: 3]`
  - `[foo: "foo", bar: "bar"]` => Map Num String
  - `[foo: String, bar: Num]` => Row, overloaded syntax is differentiated by checking the row term against `Type`
  - multimap?
  - table?
- Telescope?
  - Allow `.foo.bar.baz` syntax
- Indexing operator syntax `foo[0] || foo['bar']`
  - QUESTION: possibility of unifying rows and indexed types under 1 syntax and more generic/flexible type?
- Type operators for row manipulation
- SQL-like data traversal
- backcall
- loop/repeat for iteration

### Features

- Type level singleton String and Nums
  - Adapt normalization to reduce string operations, arithmetic and logical expressions
  - rely on bidir for implementation
    - infer `1` as `Num`. Check `1: 1` as well as `1: Type` and `1: Num`
    - implications for interop with rows and indexed types?
- Reflection
  - Tag runtime values with their type
- Debugging?
  - Source maps?
- Modalities
  - Usage semantics overhaul
  - Refinements?
    - Implementing CAS instead of SMT?
  - Effect system
  - Mutation
    - Ref count?
  - Termination metrics?
  - Call semantics
    - strict/lazy

### Type inference

- Mutual recursion
  - multiple passes
  - module level constraint solving
- Cyclic dependencies
  - Check Discord?
  - Same issue as mutual recursion
  - QUESTION: Allow separate module definition files?
- First class polymorphism:
  - Andras Kovacs DOE
  - Higher order unification?
- Track mu-type unfoldings and fold them back for display purposes

### Lowering

- Type erasure
- Pattern matching implementations
  - Unification?
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

- Testing
- Get rid of the whole monad?
  - Debugging and stack tracing is hard
