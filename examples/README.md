# Yap Language Tour

Welcome to Yap! This guide walks through all the language features currently implemented, starting from the basics and gradually introducing more advanced concepts.

## Table of Contents

- [Primitives & Literals](#primitives--literals)
- [Functions & Application](#functions--application)
- [Records & Tuples](#records--tuples)
- [Variants & Tagged Values](#variants--tagged-values)
- [Pattern Matching](#pattern-matching)
- [Statement Blocks](#statement-blocks)
- [Foreign Function Interface (FFI)](#foreign-function-interface-ffi)
- [Defining Types](#defining-types)
- [Polymorphism](#polymorphism)
- [Type Constructors & Recursive Types](#type-constructors--recursive-types)
- [Traits and Type Classes](#traits-and-type-classes)
- [Higher-Kinded Polymorphism](#higher-kinded-polymorphism)
- [Row Polymorphism](#row-polymorphism)
- [Dependent Types](#dependent-types)
- [Recursive Functions](#recursive-functions)
- [Refinement Types](#refinement-types)

---

## Primitives & Literals

Yap has a small set of primitive types and values:

```ocaml
let b: Bool = true;
let n: Num = 42;
let greeting: String = "Hello, Yap!";
let u: Unit = !;     
```

Export all declarations in a module with `export *`:

```ocaml
export *;
```

---

## Functions & Application

### Lambda Expressions

Functions are first-class values. Create them with lambda syntax:

```ocaml
let add: Num -> Num -> Num
    = \x -> \y -> x + y;

let identity: Num -> Num
    = \x -> x;

let forty2 = identity 42;
let added = add 10 20;  
```

> **Note:** Better syntax sugar for multiple parameters (like `\x y -> ...`) is coming, but isn't implemented yet as we're focusing on core semantics and features first.

### Higher-Order Functions

Functions can take and return other functions:

```ocaml
let compose: (Num -> Num) -> (Num -> Num) -> Num -> Num
    = \f -> \g -> \x -> f (g x);

let add1 = \x -> x + 1;
let add5 = \x -> x + 5;
let double = \x -> x * 2;

let add1ThenDouble = compose double add1;
```

---

## Records & Tuples

### Records

Records are structural types with named fields:

```ocaml
let point: { x: Num, y: Num }
    = { x: 0, y: 10 };    

let person: { name: String, age: Num }
    = { name: "Alice", age: 30 };
```

### Self-Referencing Fields

Inside a record, you can reference other fields using the `:fieldName` syntax:

```ocaml
let rectangle: { width: Num, height: Num, area: Num }
    = { width: 10, height: 20, area: :width * :height };
```

The `:width` syntax means "the value of the width field in this record". This is particularly useful for computed fields and, as we'll see later, for recursive definitions.

### Field Access

Access record fields using dot notation:

```ocaml
let xCoord = point.x;
let getX: { x: Num, y: Num } -> Num
    = \p -> p.x;
```

### Field Extension

Extend records by injecting new fields:

```ocaml
let point3d = { point | y = 20, z = 30 };
```

### Tuples

Tuples are syntactic sugar for records with numeric labels:

```ocaml
let pair: { Num, String }
    = { 42, "answer" };
let pairExplicit: { 0: Num, 1: String }
    = { 0: 42, 1: "answer" };
```

### Arrays and Dictionaries

Arrays are indexed by numbers, dictionaries by strings:

```ocaml
let array: { [Num]: Num }
    = [1, 2, 3];
let dict: { [String]: Num }
    = { one: 1, two: 2, three: 3 };
```

These desugar to `Indexed` types backed by FFI implementations.

---

## Variants & Tagged Values

Variants represent a choice between different alternatives. Create variant values using the `#tag` syntax:

```ocaml
let TrafficLight: Type
    = | #red Unit | #yellow Unit | #green Unit;

let light: TrafficLight = #red !;
let unkownColor = #purple !;
```

Each variant alternative (tag) carries a value. Here we use `Unit` (the `!` value) for simple flags.

### Variants with Data

Tags can carry meaningful data:

```ocaml
let Shape: Type
    = | #circle Num
      | #rectangle { Num, Num }
      | #point { x: Num, y: Num };

let c: Shape = #circle 5.0;
let r: Shape = #rectangle { 10, 20 };
let p: Shape = #point { x: 0, y: 0 };
```

---

## Pattern Matching

Use `match` to destructure values:

### Literal Patterns

```ocaml
let isZero: Num -> Bool
    = \n -> match n
        | 0 -> true
        | _ -> false;
```

### Record Patterns

```ocaml
let getY: { x: Num, y: Num } -> Num
    = \p -> match p
        | { x: a, y: b } -> b;

let getY2: { x: Num, y: Num } -> Num
    = \p -> match p
        | { y: a } -> a;
```

Please note that totality/exhaustiveness checks are not yet fully supported.

### Variant Patterns

```ocaml
let describeShape: Shape -> String
    = \s -> match s
        | #circle r             -> "Circle with radius"
        | #rectangle { w, h }   -> "Rectangle"
        | #point { x: _, y: _ } -> "Point at coordinates";
```

### List Patterns

Arrays and lists support special pattern syntax:

```ocaml
let firstOrZero: { [Num]: Num } -> Num
    = \list -> match list
        | []         -> 0
        | [x | xs]   -> x;

let tail: { [Num]: Num } -> { [Num]: Num }
    = \list -> match list
        | [] -> []
        | [x | xs] -> xs;
```

---

## Statement Blocks

Blocks contain a sequence of statements and return the value of the final `return`:

```ocaml
let compute: Num -> Num
    = \x -> {
        let doubled = x * 2;
        let added = doubled + 10;
        return added;
    };
let computed = compute 5; 
```

Blocks enable sequential computation and local bindings.

### Side Effects in Blocks

Yap is **not a pure language** - blocks can perform side effects. For example, you can use `print` to output values:

```ocaml
let debug: Num -> Num
    = \x -> {
        print "Computing...";
        let result = x * 2;
        print (stringify result);
        return result;
    };

let run = \x:Unit -> {
    print "hello world";
};
```

The `print` function (which we'll see is implemented via FFI next) performs I/O. Yap currently does not track or restrict side effects - this is a pragmatic choice for ergonomics.

> **Note:** In the future, an effect system may provide more control over side effects, but Yap intentionally avoids forcing Haskell-style monadic IO or requiring purity.

---

## Foreign Function Interface (FFI)

Interact with external code using `foreign` declarations:

### Basic FFI

```ocaml
foreign print: String -> Unit;
foreign stringify: (a: Type) => a -> String;
```

As you may have noticed in the Statement Blocks section earlier, `print` is indeed implemented via FFI!

### Polymorphic FFI

FFI functions can be polymorphic:

```ocaml
foreign stringify: (a: Type) => a -> String;
```

### FFI Implementations

Provide implementations in a `.ffi.js` file:

```javascript
// lib.ffi.js
export const print = msg => console.log(msg);

// Polymorphic functions need an extra parameter for the type!
export const stringify = typeArg => x => JSON.stringify(x);
```

The compiler links these at compile time when generating JS code.

> **Important:** Type parameters are **not yet erased** during compilation. This means polymorphic FFI functions must accept an extra argument for each type parameter, even though you don't use it. The `typeArg` parameter exists but should be ignored - it's nonsensical in JavaScript but required due to types not being erased. This will be fixed when type erasure is implemented.

For non-polymorphic functions, no extra parameter is needed:

```javascript
export const print = msg => console.log(msg); // No type param, no extra arg
```

---

## Defining Types

### First-Class Types

In Yap, types are **first-class values**. This means you can:

- Bind types to variables
- Pass types as function arguments
- Return types from functions
- Compute types at runtime

The type `Type` is the type of all types:

```ocaml
let MyNum: Type = Num;
let MyString: Type = String;

let num: MyNum = 42;  
let str: MyString = "hi";
```

Only values of type `Type` are allowed on the right-hand side of the `:` (type annotation) operator!

### Type Aliases

Define convenient names for complex types:

```ocaml
let Point: Type
    = { x: Num, y: Num };
let origin: Point = { x: 0, y: 0 };
```

---

## Polymorphism

Now that we've seen how types are first-class values, we can understand polymorphism: functions that work with many different types.

### Parametric Polymorphism

Write functions that work with any type by adding a type parameter:

```ocaml
let idExplicit: (a: Type) -> a -> a
    = \a -> \x -> x;
let n1 = idExplicit Num 42; 

let const: (a: Type) -> (b: Type) -> a -> b -> a
    = \a -> \b -> \x -> \y -> x;

let constNumStr = const Num String 1 "hello";
```

Notice the type parameter `a: Type`. Since types are first-class, we simply add an extra parameter of type `Type`.

### Implicit Parameters

Writing `\a -> \x -> x` for every polymorphic function gets tedious. Yap provides **implicit parameters** with the `=>` syntax that are automatically filled in by the compiler.

#### What are Implicits?

Implicit parameters are resolved **automatically** by the type system - you don't have to pass them explicitly:

```ocaml
let id: (a: Type) => a -> a
    = \x -> x; 

let n2 = id 42;    
let s2 = id "hello";  
```

Notice:

1. The **type signature** declares `(a: Type) =>` to indicate an implicit parameter
2. The **implementation** does NOT need to bind it with `\a =>`
3. **Applications** do NOT need to pass the type - it's inferred

This is the key difference from explicit parameters!

#### Forcing Implicits Explicitly

Sometimes you want to override automatic inference. Use `@` to pass an implicit explicitly:

```ocaml
let forcedStr = id @String "hello"; 
```

### Let-Polymorphism in Blocks

Let bindings inside blocks are automatically generalized, allowing them to be used at multiple types:

```ocaml
let letpoly: Num
    = {
        let innerID = \x -> x;  
        let n: Num = innerID 42;  
        let s: String = innerID "hi";  
        return n;
    };
```

This automatic generalization is called **let-polymorphism**. The compiler infers that `innerID` should be polymorphic and automatically adds the implicit type parameter.

---

## Type Constructors & Recursive Types

### Type Constructors

Since types are first-class, functions can take types as input and return new types as output. These are called **type constructors**:

```ocaml
let Maybe: Type -> Type
    = \a -> | #nothing Unit | #just a;
let maybeNum: Maybe Num = #just 42;
let maybeStr: Maybe String = #nothing !;
```

The syntax `Type -> Type` means "a function from types to types".

### Lists

```ocaml
let List: Type -> Type
    = \a -> | #nil Unit | #cons { a, List a };

let empty: List Num = #nil !;
let listOf1: List Num = #cons { 1, #nil ! };
let listOf3: List Num = #cons { 1, #cons { 2, #cons { 3, #nil ! } } };
```

### Natural Numbers (Peano)

```ocaml
let Peano: Type
    = | #zero Unit | #succ Peano;

let zero: Peano = #zero !;
let first: Peano = #succ zero;
let second: Peano = #succ first;
```

> **Note:** Recursive types are currently **coinductive** (lazily evaluated). The compiler doesn't enforce termination, though it will error after 1000 iterations during type-level computation to prevent infinite loops. Proper inductive types with termination checking may be added in the future.

---

## Traits and Type Classes

Yap has no built-in interface or trait system, but implicits are sufficient to emulate traits and type classes from other languages.

### Defining a Trait

A "trait" is just a record type describing required operations:

```ocaml
let Show: Type -> Type
    = \t -> { show: t -> String };
let Eq: Type -> Type
    = \t -> { eq: t -> t -> Bool };
```

### Implementing Traits

Create "instances" by building records that match the trait type:

```ocaml
let ShowNum: Show Num
    = { show: \n -> stringify n };
let ShowBool: Show Bool
    = { show: \b -> match b | true -> "true" | false -> "false" };

let EqNum: Eq Num
    = { eq: \x -> \y -> x == y };
```

### Using Traits with Implicits

Write functions that require trait constraints:

```ocaml
let display: (t:Type) => (show: Show t) => (x: t) -> String
    = \x -> show.show x;

let areEqual: (t: Type) => (eq: Eq t) => (x: t) -> (y: t) -> Bool
    = \x -> \y -> eq.eq x y;
```

### The `using` Statement

The `using` statement brings a value into implicit scope, making it available for automatic resolution:

```ocaml
using ShowNum;
using EqNum;

let pretty = display 42;     
let same = areEqual 10 10; 
let diff = areEqual 5 10; 
```

This is how Haskell-style type classes work in Yap!

---

## Higher-Kinded Polymorphism

For more advanced abstractions like Functors and Monads, you can be polymorphic over type constructors (functions from `Type -> Type`):

### Functor Abstraction

Define a Functor abstraction: something with a map operation:

```ocaml
let Functor: (Type -> Type) -> Type
    = \f -> { map: (a: Type) => (b: Type) => (a -> b) -> f a -> f b };
```

### Implementing Functor for List

Implement map for List:

```ocaml
let mapList: (a: Type) => (b: Type) => (a -> b) -> List a -> List b
    = \f -> \list -> match list
        | #nil _           -> #nil !
        | #cons { x, xs }  -> #cons { f x, mapList f xs };

let ListFunctor: Functor List
    = { map: mapList };
```

### Using Higher-Kinded Polymorphism

```ocaml
let fmap: (f: Type -> Type) => (functor: Functor f) => (a: Type) => (b: Type) =>
                    (a -> b) -> f a -> f b
    = \fn -> \container -> functor.map fn container;

let strmap = fmap stringify;

let strList = strmap listOf1;
```

This pattern works for Monads, Applicatives, and other higher-kinded abstractions. After all, polymorphism in Yap is simply higher order functions!

#### Implicit Lookup by Type

**Critical detail**: Implicits are looked up **by type**! The compiler searches for values in scope that match the required implicit type, and implicits compose across function calls.

---

## Row Polymorphism

Row polymorphism allows functions to work with records that have "at least" certain fields, without specifying all fields.

### The Row Type

Just like `Type` is the type of types, `Row` is the type of rows. Rows describe the structure (labels and types) of records and variants.

Row literals use brackets with label-type pairs:

```ocaml
let r: Row = [x: Num, y: String]; 
```

**Note:** Row literals are only used at the type level to describe structure. You cannot create row values directly - rows describe the shape of records and variants.

### Open Records

**Open records** use row variables to allow additional fields:

```ocaml
let getOpenX: (r: Row) => { x: Num | r } -> Num
    = \record -> record.x;

let p1 = getOpenX { x: 10, y: 20 };
let p2 = getOpenX { x: 5, y: 3, z: 7 };
let p3 = getOpenX { x: 100, name: "point" };
```

The type `{ x: Num | r }` means "a record with at least an `x` field of type `Num`, plus whatever fields are in `r`".

### Polymorphic Projection

Row polymorphism makes generic accessors possible:

```ocaml
let getName: (r: Row) => { name: String | r } -> String
    = \obj -> obj.name;

let person = { name: "Alice", age: 30 };
let book = { name: "1984", author: "Orwell", pages: 328 };

let name1 = getName person; 
let name2 = getName book;  
```

### Polymorphic Extension

Extend records while preserving row polymorphism:

```ocaml
let addZ: (r: Row) => { x: Num, y: Num | r } -> { x: Num, y: Num, z: Num | r }
    = \rec -> { rec | z = 0 };
```

---

## Dependent Types

Dependent types allow types to depend on **values**. This enables extremely precise type signatures.

### Polymorphism is Dependent!

Actually, we've already been using dependent types! When we wrote:

```ocaml
let idExplicit: (a: Type) -> a -> a
    = \a -> \x -> x;
```

The return type `a` depends on the **value** of the parameter `a`. This is a **dependent function type**, also called a **Pi type**.

Polymorphism is just a familiar case of dependent types where **values depend on types**. But Yap allows the dual too: **types depending on values**!

### Dependent Functions (Pi Types)

A simple example using dependent types:

```ocaml
let makeType: Bool -> Type
    = \b -> match b
        | true  -> Num
        | false -> String;
let T1: Type = makeType true;
let T2: Type = makeType false;
```

The return type depends on the input value!

### Length-Indexed Vectors

A classic example - vectors whose type tracks their length:

```ocaml
let Vec: Num -> Type -> Type
    = \n -> \t -> match n
        | 0 -> Unit
        | l -> { t, Vec (l - 1) t };

let vec0: Vec 0 Num = !;
let vec1: Vec 1 Num = { 10, vec0 };
let vec2: Vec 2 Num = { 20, vec1 };
let vec3: Vec 3 Num = { 30, vec2 };
```

The type `Vec 3 Num` can only hold exactly 3 numbers!

## NOTE:

At the moment, it is not possible to use inference/unification to resolve numeric constraints, which limits some advanced dependent type patterns. This may be improved in future versions.

### Dependent Records (Sigma Types)

Remember the `:fieldName` syntax we saw earlier for computed fields? It becomes especially powerful with dependent types - field types can reference earlier field **values**:

```ocaml
let DependentPair: Type
    = { fst: Type, snd: :fst };

let numPair: DependentPair
    = { fst: Num, snd: 42 };
let strPair: DependentPair
    = { fst: String, snd: "hello" };
```

The type of `snd` is whatever value `fst` holds!

### Generic Dependent Pairs

Make dependent pairs polymorphic:

```ocaml
let Pair: (a: Type) -> (p: a -> Type) -> Type
    = \a -> \p -> { fst: a, snd: p :fst };

let exampleP1: Pair Num (\n -> String)
    = { fst: 42, snd: "hello" };
let exampleP2: Pair Bool (\b -> match b | true -> Num | false -> String)
    = { fst: true, snd: 100 };
```

## Recursive Functions

Use pattern matching to write recursive functions:

```ocaml
let length: (a: Type) => List a -> Num
    = \list -> match list
        | #nil _           -> 0
        | #cons { x, xs }  -> 1 + (length xs);
```

### Recursive Record Fields

The `:fieldName` syntax we introduced in the Records section is especially useful for recursive definitions:

```ocaml
let Factorial: Type
    = { compute: Num -> Num };

let fact: Factorial
    = { compute: \n -> match n
        | 0 -> 1
        | _ -> n * (:compute (n - 1))
    };

let computedFac = fact.compute 5; 
```

The `:compute` refers to the 'compute' field itself, enabling recursion.

---

## Refinement Types

Refinement types let you constrain values with logical predicates. The compiler verifies these constraints statically using an SMT solver.

### Basic Refinements

Refine a primitive type with a predicate over its values:

```ocaml
let Nat: Type
    = Num [|\n -> n >= 0 |];

let Pos: Type
    = Num [|\p -> p > 0 |];

let n: Nat = 42; 
let p: Pos = 42; 
let zero: Nat = 0; 
```

The syntax `[|\n -> n >= 0 |]` is a refinement predicate - a lambda that returns a boolean.

### Exact Value Refinements

You can specify exact values:

```ocaml
let exactOne: Num [|\v -> v == 1 |] = 1; 
```

### Pre and Postconditions

Refinements track relationships between function inputs and outputs:

```ocaml
let inc: (x: Num) -> Num [|\v -> v == (x + 1) |]
    = \x -> x + 1;
```

Here, the refinement `\v -> v == (x + 1)` references the parameter `x`, creating a dependency between input and output.

### Higher-Order Functions with Refinements

Refinements work through function composition:

```ocaml
let hof: (f: Nat -> Nat) -> Nat
    = \f -> f 1;

let hof2: (Num -> Nat) -> Pos
    = \f -> (f 1) + 1;
```

### Refinement Subtyping

Refinements create a subtyping hierarchy. Function parameters are **contravariant** - they reverse the subtyping direction:

```ocaml
let takePosFunction: (Pos -> Num) -> Num
    = \f -> f 10;

let natToNum: Nat -> Num = \x -> x;
let posToNum: Pos -> Num = \x -> x;

let result1 = takePosFunction natToNum;
let result2 = takePosFunction posToNum;
```

Why? If you need a function that works on `Pos`, a function that works on `Nat` is **more general** - it accepts everything `Pos` does and more!

### Refinement Polymorphism

Refinement polymorphism allows you to write functions that are polymorphic over the refinement predicate itself:

```ocaml
let checkNum: (p: Num -> Bool) -> Num[| \v -> p v |] -> Num
    = \p -> \x -> x;

let nat5 = checkNum (\n -> n >= 0) 5; 

let safeInc: (p: Num -> Bool) -> (x: Num[|\v -> p (v + 1) |]) -> Num[|\v -> p v |]
    = \p -> \x -> x + 1;
let natInc = safeInc (\n -> n >= 0); 
let posInc = safeInc (\n -> n > 0); 
```

The predicate parameter `p` makes the function work with different refinements!

### Dependent Types with Refinements

Combine dependent types (types depending on values) with refinements for powerful invariants:

```ocaml
let OrderedPair: Type
    = { fst: Num, snd: Num[|\v -> v > :fst |] };

let valid: OrderedPair = { fst: 3, snd: 5 }; 
let invalid: OrderedPair = { fst: 5, snd: 3 }; 
```

The `:fst` syntax references the first field's **value** in the refinement predicate.

### Combining Refinement Polymorphism with Dependent Types

For maximum flexibility, abstract over **both** the predicate and use dependent types:

```ocaml
let OrderedList: (t: Type) -> (p: t -> t -> Bool) -> Type
    = \t -> \p -> 
        | #nil Unit
        | #cons { head: t, tail: OrderedList (t[| \v -> p :head v |]) p };

let ascending: OrderedList Num (\x -> \y -> x < y)
    = #cons { head: 1, tail: #cons { head: 2, tail: #cons { head: 3, tail: #nil ! } } };

let descending: OrderedList Num (\x -> \y -> x > y)
    = #cons { head: 3, tail: #cons { head: 2, tail: #cons { head: 1, tail: #nil ! } } };
```

This combines:
- **Refinement polymorphism**: `p` is a parameter
- **Dependent types**: `:head` references the field value
- **Refinements**: `t[|\v -> p :head v |]` constrains tail elements

### How It Works

The compiler:
1. Collects refinement constraints during type checking
2. Translates predicates to SMT-LIB logical formulas
3. Queries an SMT solver (Z3) to verify the constraints
4. Reports type errors if verification fails

> **Learn more about SMT:** Satisfiability Modulo Theories (SMT) solvers are tools that can automatically reason about logical formulas. See [Z3 documentation](https://github.com/Z3Prover/z3) for details.

---

## What's Next?

This guide covers the currently implemented features of Yap. The language is under active development, so expect:

- More syntactic sugar (infix operators, where clauses, better lambda syntax, etc.)
- Effect system via delimited continuations
- Reflection for runtime type information
- Better tooling (LSP, debugger, syntax highlighting)
- Additional backends (C, and beyond)

Check out the example files:

- `yap/lib.yap` - Core library with common types and functions
- `yap/main.yap` - Example programs
- `yap/debug.yap` - Comprehensive language tour examples

Happy hacking!

