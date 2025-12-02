# Yap Language Tour

Welcome to Yap! This guide walks through all the language features currently implemented, starting from the basics and gradually introducing more advanced concepts.

## Table of Contents

- [Primitives & Literals](#primitives--literals)
- [Top-Level Declarations](#top-level-declarations)
- [Functions & Application](#functions--application)
- [Records & Tuples](#records--tuples)
- [Variants & Tagged Values](#variants--tagged-values)
- [Pattern Matching](#pattern-matching)
- [Statement Blocks](#statement-blocks)
- [Defining Types](#defining-types)
- [Polymorphism](#polymorphism)
- [Row Polymorphism](#row-polymorphism)
- [Common Patterns](#common-patterns)
- [Dependent Types](#dependent-types)
- [Recursive Types](#recursive-types)
- [Refinement Types](#refinement-types)
- [Foreign Function Interface (FFI)](#foreign-function-interface-ffi)

---

## Primitives & Literals

Yap has a small set of primitive types and values:

```ocaml
let n: Num = 42;           // Numbers (integers and floats)
let s: String = "hello";   // Strings
let b: Bool = true;        // Booleans (true, false)
let u: Unit = !;           // Unit type (like void, but a value)
```

---

## Top-Level Declarations

You can bind values and types using `let`:

```ocaml
let greeting: String = "Hello, Yap!";

let add: Num -> Num -> Num
    = \x -> \y -> x + y;
```

Export all declarations in a module with `export *`:

```ocaml
export *;

let publicValue: Num = 42;
```

Import other modules:

```ocaml
import "lib.yap";
```

---

## Functions & Application

### Lambda Expressions

Functions are first-class values. Create them with lambda syntax:

```ocaml
let identity: Num -> Num
    = \x -> x;

let const: Num -> String -> Num
    = \x -> \y -> x;
```

> **Note:** Better syntax sugar for multiple parameters (like `\x y -> ...`) is coming, but isn't implemented yet as we're focusing on core semantics and features first.

### Function Application

Apply functions by juxtaposition:

```ocaml
let result1 = identity 42;
let result2 = add 10 20;            // Multi-argument application
```

### Higher-Order Functions

Functions can take and return other functions:

```ocaml
let compose: (Num -> Num) -> (Num -> Num) -> Num -> Num
    = \f -> \g -> \x -> f (g x);

let addOne: Num -> Num = \x -> x + 1;
let add5: Num -> Num = \x -> x + 5;

let double = \x -> x * 2;

let addOneThenDouble = compose double addOne;
// addOneThenDouble 5 == 12
```

---

## Records & Tuples

### Records

Records are structural types with named fields:

```ocaml
let point: { x: Num, y: Num }
    = { x: 10, y: 20 };

let person: { name: String, age: Num }
    = { name: "Alice", age: 30 };
```

### Field Access

Access record fields using dot notation:

```ocaml
let point = { x: 10, y: 20 };
let xCoord = point.x;              // 10

let getX: { x: Num, y: Num } -> Num
    = \p -> p.x;
```

### Self-Referencing Fields

Inside a record, you can reference other fields using the `:fieldName` syntax:

```ocaml
let rectangle: { width: Num, height: Num, area: Num }
    = { width: 10, height: 20, area: :width * :height };
// rectangle.area == 200
```

The `:width` syntax means "the value of the width field in this record". This is particularly useful for computed fields and, as we'll see later, for recursive definitions.

### Field Extension

Extend records by injecting new fields:

```ocaml
let point = { x: 10 };
let point3d = { point | y = 20, z = 30 };
// point3d : { x: Num, y: Num, z: Num }
```

You can override existing fields:

```ocaml
let updated = { point | x = 100 };
// updated : { x: Num }
```

### Tuples

Tuples are syntactic sugar for records with numeric labels:

```ocaml
let pair: { Num, String }
    = { 42, "answer" };

// Equivalent to:
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
// A simple binary choice
let TrafficLight: Type
    = | #red Unit | #yellow Unit | #green Unit;

let light: TrafficLight = #red !;
```

Each variant alternative (tag) carries a value. Here we use `Unit` (the `!` value) for simple flags.

### Variants with Data

Tags can carry meaningful data:

```ocaml
let Shape: Type
    = | #circle Num              // radius
      | #rectangle { Num, Num }  // width, height
      | #point { x: Num, y: Num };


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
let getX: { x: Num, y: Num } -> Num
    = \p -> match p
        | { x: a, y: b } -> a;

// Can ignore fields
let getX2: { x: Num, y: Num } -> Num
    = \p -> match p
        | { x: a } -> a;
```

Please note that totality/exhaustiveness checks are not yet fully supported.

### Variant Patterns

```ocaml
let describeShape: Shape -> String
    = \s -> match s
        | #circle r           -> "Circle with radius"
        | #rectangle { w, h } -> "Rectangle"
        | #point { x: _, y: _ }     -> "Point at coordinates";
```

### List Patterns

Arrays and lists support special pattern syntax:

```ocaml
let firstOrZero: { [Num]: Num } -> Num
    = \list -> match list
        | []         -> 0
        | [x | xs]   -> x;
```

let tail: { [Num]: Num } -> { [Num]: Num }
= \list -> match list
| [] -> []
| [x | xs] -> xs;

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

let result = compute 5;  // 20
```

Blocks enable sequential computation and local bindings.

### Side Effects in Blocks

Yap is **not a pure language** - blocks can perform side effects. For example, you can use `print` to output values:

```ocaml
let debug: Num -> Num
    = \x -> {
        print "Computing...";
        let result = x * 2;
        print ("Result: " ++ stringify result);
        return result;
    };
```

The `print` function (which we'll see is implemented via FFI later) performs I/O. Yap currently does not track or restrict side effects - this is a pragmatic choice for ergonomics.

> **Note:** In the future, an effect system may provide more control over side effects, but Yap intentionally avoids forcing Haskell-style monadic IO or requiring purity.

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

let n: MyNum = 42;        // Same as Num
let s: MyString = "hi";   // Same as String
```

Only values of type `Type` are allowed on the right-hand side of the `:` (type annotation) operator!

### Type Aliases

Define convenient names for complex types:

```ocaml
let Point: Type
    = { x: Num, y: Num };

let origin: Point = { x: 0, y: 0 };
```

### Type Constructors

Since types are first-class, functions can take types as input and return new types as output. These are called **type constructors**:

```ocaml
// A type constructor that wraps any type in a Maybe
let Maybe: Type -> Type
    = \a -> | #nothing Unit | #just a;

// Now we can create Maybe Num, Maybe String, etc.
let maybeNum: Maybe Num = #just 42;
let maybeStr: Maybe String = #nothing !;
```

The syntax `Type -> Type` means "a function from types to types".

### Computing Types

Since types are values, you can compute them:

```ocaml
let chooseType: Bool -> Type
    = \b -> match b
        | true  -> Num
        | false -> String;

let T: Type = chooseType true;
// T is Num
```

This enables powerful type-level programming patterns.

---

## Polymorphism

Now that we've seen how types are first-class values, we can understand polymorphism: functions that work with many different types.

### Parametric Polymorphism

Write functions that work with any type by adding a type parameter:

```ocaml
let id: (a: Type) -> a -> a
    = \a -> \x -> x;

let const: (a: Type) -> (b: Type) -> a -> b -> a
    = \a -> \b -> \x -> \y -> x;
```

Notice the type parameter `a: Type`. Since types are first-class, we simply add an extra parameter of type `Type`.

### Implicit Parameters

Writing `\a -> \x -> x` for every polymorphic function gets tedious. Yap provides **implicit parameters** with the `=>` syntax that are automatically filled in by the compiler.

#### What are Implicits?

Implicit parameters are resolved **automatically** by the type system - you don't have to pass them explicitly:

```ocaml
// Explicit version - must pass the type manually
let idExplicit: (a: Type) -> a -> a
    = \a -> \x -> x;

let n1 = idExplicit Num 42;  // Must write Num

// Implicit version - type parameter filled in automatically
let id: (a: Type) => a -> a
    = \x -> x;  // No \a => needed in the implementation!

let n2 = id 42;              // Num inferred from 42
let s = id "hello";          // String inferred from "hello"
```

Notice:

1. The **type signature** declares `(a: Type) =>` to indicate an implicit parameter
2. The **implementation** does NOT need to bind it with `\a =>`
3. **Applications** do NOT need to pass the type - it's inferred

This is the key difference from explicit parameters!

#### Forcing Implicits Explicitly

Sometimes you want to override automatic inference. Use `@` to pass an implicit explicitly:

```ocaml
let result = id @String "hello";  // Force the type to String
```

### Let-Polymorphism in Blocks

Let bindings inside blocks are automatically generalized, allowing them to be used at multiple types:

```ocaml
let example: Num
    = {
        let id = \x -> x;          // Generalized to (a: Type) => a -> a
        let n: Num = id 42;        // Used at Num
        let s: String = id "hi";   // Used at String
        return n;
    };
```

let example: Num
= {
let id1 = \x -> x;  
 let n: Num = id1 42;  
 let s: String = id1 "hi";  
 return n;
};

This automatic generalization is called **let-polymorphism**. The compiler infers that `id` should be polymorphic and automatically adds the implicit type parameter.

### Traits and Type Classes with Implicits

Yap has no built-in interface or trait system, but implicits are sufficient to emulate traits and type classes from other languages.

#### Defining a Trait

A "trait" is just a record type describing required operations:

```ocaml
// A Show trait for things that can be converted to strings
let Show: Type -> Type
    = \t -> { show: t -> String };

// A trait for comparable things
let Eq: Type -> Type
    = \t -> { eq: t -> t -> Bool };
```

#### Implementing Traits

Create "instances" by building records that match the trait type:

```ocaml
// Show instance for Num
let ShowNum: Show Num
    = { show: \n -> stringify n };

// Show instance for Bool
let ShowBool: Show Bool
    = { show: \b -> match b | true -> "true" | false -> "false" };

// Eq instance for Num
let EqNum: Eq Num
    = { eq: \x y -> x == y };
```

#### Using Traits with Implicits

Write functions that require trait

let areEqual: (eq: Eq t) => (x: t) -> (y: t) -> Bool
= \x y -> eq.eq x y;

````

#### The `using` Statement

The `using` statement brings a value into implicit scope, making it available for automatic resolution:

```ocaml
using ShowNum;  // Make ShowNum available for implicit resolution

// Now any function requiring (show: Show Num) => will use it
````

Bring instances into scope and use them:

```ocaml
using ShowNum;
using EqNum;

let str = display 42;           // "42" - uses ShowNum
let same = areEqual 10 10;      // true - uses EqNum
let diff = areEqual 5 10;       // false
```

#### Multiple Constraints

Functions can require multiple trait instances:

```ocaml
let displayIfEqual: (show: Show t) => (eq: Eq t) => (x: t) -> (y: t) -> String
    = \x y -> match (eq.eq x y)
        | true  -> "Equal: " ++ show.show x
        | false -> "Not equal";

using ShowNum;
using EqNum;

let msg = displayIfEqual 5 5;   // "Equal: 5"
```

This is how Haskell-style type classes work in Yap!

### Higher-Kinded Polymorphism

For more advanced abstractions like Functors and Monads, you can be polymorphic over type constructors (functions from `Type -> Type`):

```ocaml
// First, define a List type constructor
let List: Type -> Type
    = \a -> | #nil Unit | #cons { a, List a };

// Define a Functor abstraction: something with a map operation
let Functor: (Type -> Type) -> Type
    = \f -> {
        map: (a: Type) => (b: Type) => (a -> b) -> f a -> f b
    };

// Implement map for List
let mapList: (a: Type) => (b: Type) => (a -> b) -> List a -> List b
    = \f -> \list -> match list
        | #nil _           -> #nil !
        | #cons { x, xs }  -> #cons { f x, mapList f xs };

// Create a Functor instance for List
let ListFunctor: Functor List
    = { map: mapList };
```

Use it the same way:

```ocaml
let polymorphicMap: (f: Type -> Type) => (functor: Functor f) => (a: Type) => (b: Type) =>
                    (a -> b) -> f a -> f b
    = \fn -> \container -> functor.map fn container;

using ListFunctor;

let empty: List Num = #nil !;
let one: List Num = #cons { 1, #nil ! };
let someList = #cons { 1, #cons { 2, #cons { 3, #nil ! } } };
let result = polymorphicMap (\x -> x + 1) someList;
```

This pattern works for Monads, Applicatives, and other higher-kinded abstractions. Afterall, polymorphism in Yap is simply higher order functions!

#### Implicit Lookup by Type

**Critical detail**: Implicits are looked up **by type**! The compiler searches for values in scope that match the required implicit type.

```ocaml
using ListFunctor;  // Type: Functor List

// When polymorphicMap needs (functor: Functor List) =>,
// the compiler searches for a value of type "Functor List" and finds ListFunctor
let result = polymorphicMap (\x -> x + 1) someList;
```

If no matching value is in scope via `using`, the implicit parameter remains abstract:

```ocaml
// Without 'using ListFunctor' in scope:
let polyFunc: (functor: Functor List) => List Num -> List Num
    = \list -> polymorphicMap (\x -> x + 1) list;
// The 'functor' parameter stays abstract and will be filled in at call sites
```

This means implicits compose! You can write functions that require implicits, and those implicits will be resolved wherever the function is called.

### Implicit Resolution Rules

1. **Lookup by type**: The compiler searches for values matching the implicit's type
2. **Module boundaries**: Implicits are never carried across module boundaries
3. **Explicit scoping**: Use `using <value>` to bring a value into implicit scope
4. **Ambiguity warnings**: If multiple implicits of the same type exist, the compiler warns
5. **Override with @**: You can always explicitly pass a value: `polymorphicMap @OtherFunctor func list`
6. **Composability**: Functions with implicit parameters can call other functions with implicit parameters - resolution happens at the final call site

---

## Row Polymorphism

Row polymorphism allows functions to work with records that have "at least" certain fields, without specifying all fields.

### The Row Type

Just like `Type` is the type of types, `Row` is the type of rows. Rows describe the structure (labels and types) of records and variants.

Row literals use brackets with label-type pairs:

```ocaml
let r: Row = [x: Num, y: String];  // A row with two labels
```

**Note:** Row literals are only used at the type level to describe structure. You cannot create row values directly - rows describe the shape of records and variants.

### Open vs Closed Records

By default, record types in Yap are **closed** - they specify exactly which fields exist:

```ocaml
let point: { x: Num, y: Num }
    = { x: 10, y: 20 };

// This does NOT work - too many fields
// let p: { x: Num, y: Num } = { x: 1, y: 2, z: 3 };  // ERROR
```

**Open records** use row variables to allow additional fields:

```ocaml
let getX: (r: Row) => { x: Num | r } -> Num
    = \record -> record.x;

// Works with any record containing an 'x: Num' field
let p1 = getX { x: 10, y: 20 };              // OK
let p2 = getX { x: 5, y: 3, z: 7 };          // OK
let p3 = getX { x: 100, name: "point" };     // OK
```

The type `{ x: Num | r }` means "a record with at least an `x` field of type `Num`, plus whatever fields are in `r`".

### Polymorphic Projection

Row polymorphism makes generic accessors possible:

```ocaml
let getName: (r: Row) => { name: String | r } -> String
    = \obj -> obj.name;

let person = { name: "Alice", age: 30 };
let book = { name: "1984", author: "Orwell", pages: 328 };

let n1 = getName person;  // "Alice"
let n2 = getName book;    // "1984"
```

### Polymorphic Extension

Extend records while preserving row polymorphism:

```ocaml
let addZ: (r: Row) => { x: Num, y: Num | r } -> { x: Num, y: Num, z: Num | r }
    = \rec -> { rec | z = 0 };

let p1 = addZ { x: 1, y: 2 };                // { x: 1, y: 2, z: 0 }
let p2 = addZ { x: 5, y: 10, color: "red" }; // { x: 5, y: 10, z: 0, color: "red" }
```

### Row Polymorphic Variants

Variants can also be row polymorphic:

```ocaml
let handleNone: (r: Row) => (| #none Unit | r) -> String
    = \variant -> match variant
        | #none _ -> "Nothing here"
        | other   -> "Something else";

// Works with any variant that includes a #none tag
let opt: | #none Unit | #some Num = #none !;
let result1 = handleNone opt;  // "Nothing here"
```

---

## Common Patterns

Now that we've covered the basics, here are some useful patterns you'll see often:

### The Option Type

Represents an optional value - either something or nothing:

```ocaml
let Option: Type -> Type
    = \a -> | #none Unit | #some a;

let safeDivide: Num -> Num -> Option Num
    = \x -> \y -> match y
        | 0 -> #none !
        | _ -> #some (x / y);

let result = safeDivide 10 2;  // #some 5
let bad = safeDivide 10 0;     // #none !
```

### The Result Type

Represents success or failure with an error message:

```ocaml
let Result: Type -> Type -> Type
    = \err -> \ok -> | #error err | #ok ok;

let parse: String -> Result String Num
    = \s -> match s
        | "42" -> #ok 42
        | _    -> #error "Not a valid number";

let good = parse "42";    // #ok 42
let bad = parse "hello";  // #error "Not a valid number"
```

---

## Dependent Types

Dependent types allow types to depend on **values**. This enables extremely precise type signatures.

### Polymorphism is Dependent!

Actually, we've already been using dependent types! When we wrote:

```ocaml
let id: (a: Type) -> a -> a
    = \a -> \x -> x;
```

The return type `a` depends on the **value** of the parameter `a`. This is a **dependent function type**, also called a **Pi type**.

Polymorphism is just a familiar case of dependent types where **values depend on types**. But Yap allows the dual too: **types depending on values**!

### Dependent Functions (Pi Types)

A simple example using dependent types:

```ocaml
let makeType: (b: Bool) -> Type
    = \b -> match b
        | true  -> Num
        | false -> String;

let T1: Type = makeType true;   // T1 = Num
let T2: Type = makeType false;  // T2 = String
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

### Safe Head Function

With length-indexed vectors, we can write a `head` function that's guaranteed never to fail:

```ocaml
let head: (n: Num) -> (a: Type) -> Vec (n + 1) a -> a
    = \n -> \a -> \vec -> match vec
        | { x, xs } -> x;
```

The type `Vec (n + 1) a` ensures the vector has at least one element.

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

// Create a pair where the second component's type depends on the first
let example: Pair Num (\n -> String)
    = { fst: 42, snd: "hello" };

let example2: Pair Bool (\b -> match b | true -> Num | false -> String)
    = { fst: true, snd: 100 };
```

---

## Recursive Types

Now that we understand polymorphism and type constructors, we can define recursive data structures.

### Lists

```ocaml
let List: Type -> Type
    = \a -> | #nil Unit | #cons { a, List a };

let empty: List Num = #nil !;
let oneItem: List Num = #cons { 1, empty };
let twoItems: List Num = #cons { 2, oneItem };
```

### Natural Numbers (Peano)

```ocaml
let Nat: Type
    = | #zero Unit | #succ Nat;

let zero: Nat = #zero !;
let one: Nat = #succ zero;
let two: Nat = #succ one;
```

### Recursive Functions

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
    // :compute refers to the 'compute' field itself

let result = fact.compute 5;  // 120
```

> **Note:** Recursive types are currently **coinductive** (lazily evaluated). The compiler doesn't enforce termination, though it will error after 1000 iterations during type-level computation to prevent infinite loops. Proper inductive types with termination checking may be added in the future.

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

let n: Nat = 42;   // OK: 42 >= 0
let p: Pos = 42;   // OK: 42 > 0
let zero: Nat = 0; // OK: 0 >= 0
```

The syntax `[|\n -> n >= 0 |]` is a refinement predicate - a lambda that returns a boolean.

### Verification Errors

The compiler will report an error when a value doesn't satisfy the refinement:

```ocaml
let bad1: Nat = -5;   // ERROR: -5 does not satisfy n >= 0
let bad2: Pos = 0;    // ERROR: 0 does not satisfy p > 0
let bad3: Pos = -10;  // ERROR: -10 does not satisfy p > 0
```

These errors are caught at compile time via SMT solving!

### Exact Value Refinements

You can specify exact values:

```ocaml
let exactOne: Num [|\v -> v == 1 |] = 1;  // OK
let notOne: Num [|\v -> v == 1 |] = 2;    // ERROR
```

### Pre and Postconditions

Combine preconditions (on inputs) and postconditions (on outputs):

```ocaml
let safe: (n: Nat) -> Nat
    = \x -> x;  // OK: input Nat guarantees output Nat

let unsafe: (n: Nat) -> Nat
    = \x -> 0;  // ERROR: 0 violates Nat postcondition
```

Refinements track relationships between function inputs and outputs:

```ocaml
let inc: (x: Num) -> Num [|\v -> v == (x + 1) |]
    = \x -> x + 1;

// The compiler knows the result is exactly x + 1
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

The compiler verifies that:

- In `hof2`, if `f 1` returns a `Nat` (> 0), then `(f 1) + 1` is a `Pos` (> 1)

### Refinement Subtyping

Refinements create a subtyping hierarchy:

```ocaml
let useNat: Nat -> Num
    = \n -> n;

let p: Pos = 42;
let result = useNat p;  // OK: Pos <: Nat (every value > 0 is also >= 0)
```

But the reverse doesn't hold:

```ocaml
let usePos: Pos -> Num
    = \p -> p;

let n: Nat = 0;
let result = usePos n;  // ERROR: 0 is Nat but not Pos
```

### Contravariance with Higher-Order Functions

Refinement subtyping interacts with function types in interesting ways. Function parameters are **contravariant** - they reverse the subtyping direction:

```ocaml
// Pos <: Nat for values, so (Nat -> Num) <: (Pos -> Num) for functions!
let takePosFunction: (Pos -> Num) -> Num
    = \f -> f 10;

let natToNum: Nat -> Num = \x -> x;
let posToNum: Pos -> Num = \x -> x;

// This works! A function accepting Nat can be used where Pos is expected
let result1 = takePosFunction natToNum;  // OK
let result2 = takePosFunction posToNum;  // OK

// Reverse doesn't work:
let takeNatFunction: (Nat -> Num) -> Num
    = \f -> f 0;

// ERROR: posToNum can't handle 0 (not Pos)
let bad = takeNatFunction posToNum;  // ERROR
```

Why? If you need a function that works on `Pos`, a function that works on `Nat` is **more general** - it accepts everything `Pos` does and more!

### Refinement Polymorphism

Refinement polymorphism allows you to write functions that are polymorphic over the refinement predicate itself.

#### Simple Example: Polymorphic Constrained Identity

```ocaml
// A function polymorphic over any refinement on Num
let constrainedId: (p: Num -> Bool) -> Num[|\v -> p v |] -> Num
    = \x -> x;

let nat5 = constrainedId (\n -> n >= 0) 5;   // OK
let pos10 = constrainedId (\n -> n > 0) 10;  // OK
```

Here `p` is abstracted - the function works with **any** predicate.

#### Polymorphic Validated Operations

```ocaml
// Increment that preserves any predicate satisfied by (x + 1)
let safeInc: (p: Num -> Bool) -> (x: Num[|\v -> p (v + 1) |]) -> Num[|\v -> p v |]
    = \x -> x + 1;

// Use with different predicates
let natInc = safeInc (\n -> n >= 0);  // Nat -> Nat (if x >= 0, then x+1 >= 0)
let posInc = safeInc (\n -> n > 0);   // Pos -> Pos (if x > 0, then x+1 > 0)
```

The predicate parameter `p` makes the function work with different refinements!

### Dependent Types with Refinements

Now we can combine dependent types (types depending on values) with refinements for powerful invariants.

#### Dependent Pairs with Refinements

```ocaml
// The second field's type is refined based on the first field's value
let OrderedPair: Type
    = { fst: Num, snd: Num[|\v -> v > :fst |] };

let valid: OrderedPair = { fst: 3, snd: 5 };    // OK: 5 > 3
let invalid: OrderedPair = { fst: 5, snd: 3 };  // ERROR: 3 is not > 5
```

The `:fst` syntax references the first field's **value** in the refinement predicate.

#### Ordered Lists Using Dependent Types

```ocaml
let OrderedList: Type -> Type
    = \t -> | #nil Unit
            | #cons { head: t, tail: OrderedList (t[|\v -> v > :head |]) };

let orderedList: OrderedList Num
    = #cons { head: 1, tail: #cons { head: 2, tail: #cons { head: 3, tail: #nil ! } } };
```

Each tail element must be greater than the current head! This uses dependent types (`:head` reference) but hardcodes the `>` predicate.

### Combining Refinement Polymorphism with Dependent Types

For maximum flexibility, abstract over **both** the predicate and use dependent types:

```ocaml
// Polymorphic over the predicate p, with dependent refinements
let OrderedListPoly: (t: Type) -> (p: t -> t -> Bool) -> Type
    = \t -> \p -> | #nil Unit
                    | #cons { head: t, tail: OrderedListPoly (t[|\v -> p :head v |]) p };

// Now we can create lists with ANY ordering relationship!
let ascending: OrderedListPoly Num (\x y -> x < y)
    = #cons { head: 1, tail: #cons { head: 2, tail: #cons { head: 3, tail: #nil ! } } };

let descending: OrderedListPoly Num (\x y -> x > y)
    = #cons { head: 3, tail: #cons { head: 2, tail: #cons { head: 1, tail: #nil ! } } };

let nonDecreasing: OrderedListPoly Num (\x y -> x <= y)
    = #cons { head: 1, tail: #cons { head: 1, tail: #cons { head: 2, tail: #nil ! } } };
```

This combines:

- **Refinement polymorphism**: `p` is a parameter
- **Dependent types**: `:head` references the field value
- **Refinements**: `t[|\v -> p :head v |]` constrains tail elements

Powerful!

### How It Works

The compiler:

1. Collects refinement constraints during type checking
2. Translates predicates to SMT-LIB logical formulas
3. Queries an SMT solver (Z3) to verify the constraints
4. Reports type errors if verification fails

> **Learn more about SMT:** Satisfiability Modulo Theories (SMT) solvers are tools that can automatically reason about logical formulas. See [Z3 documentation](https://github.com/Z3Prover/z3) for details.

---

## Foreign Function Interface (FFI)

Interact with external code using `foreign` declarations:

### Basic FFI

```ocaml
foreign print: String -> Unit;
foreign stringify: (a: Type) => a -> String;

let greet: String -> Unit
    = \name -> {
        print ("Hello, " ++ name);
        return !;
    };
```

As you may have noticed in the Statement Blocks section earlier, `print` is indeed implemented via FFI!

### Polymorphic FFI

FFI functions can be polymorphic:

```ocaml
foreign prepend: (a: Type) => a -> Array a -> Array a;
foreign id: (a: Type) => a -> a;

let nums = prepend 42 [1, 2, 3];      // [42, 1, 2, 3]
let strs = prepend "a" ["b", "c"];    // ["a", "b", "c"]
```

### FFI Implementations

Provide implementations in a `.ffi.js` file:

```javascript
// lib.ffi.js
export const print = msg => console.log(msg);

// Polymorphic functions need an extra parameter for the type!
export const stringify = typeArg => x => JSON.stringify(x);
export const prepend = typeArg => x => arr => [x, ...arr];
export const id = typeArg => x => x;
```

The compiler links these at compile time when generating JS code.

> **Important:** Type parameters are **not yet erased** during compilation. This means polymorphic FFI functions must accept an extra argument for each type parameter, even though you don't use it. The `typeArg` parameter exists but should be ignored - it's nonsensical in JavaScript but required due to types not being erased. This will be fixed when type erasure is implemented.

For non-polymorphic functions, no extra parameter is needed:

```javascript
export const print = msg => console.log(msg); // No type param, no extra arg
```

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
- `yap/liquids.yap` - Refinement type examples

Happy hacking!
