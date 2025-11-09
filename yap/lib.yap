export *;

let Nat
    : Type
    = Num [|\n -> n > 0 |];

let Pos
    : Type
    = Num [|\p -> p > 1 |];


let inc
    : (n: Num) -> Num [|\o -> o == (n + 1) |]
    = \x -> x + 1;    


let incf
    : (x: Nat) -> Pos
    = \x -> {
        let tmp
            : (Num -> Nat) -> Pos
            = \f -> (f x) + 1;
        return tmp inc;
    };



let List
    : Type -> Type
    = \a -> | #nil Unit | #cons { a, List a };


let empty: List Num = #nil *;
let one: List Num = #cons { 1, empty };

let mapL
    : (a: Type) => (b: Type) => (a -> b) -> List a -> List b
    = \f -> \l -> match l
        | #nil _            -> #nil *
        | #cons { x, xs }   -> #cons { f x, mapL f xs };


// We don't have built in higher-kinded types and typeclasses, but we can encode them easily if needed. We make no attempt to enforce and/or encourage laws here, or even extensive use of these abstractions.
// Full user power!
let Functor 
    : (Type -> Type) -> Type
    = \f -> { map: (a: Type) => (b: Type) => (a -> b) -> f a -> f b };

let Monad
    : (Type -> Type) -> Type
    = \m -> 
      { of: (a: Type) => a -> m a
      , bind: (a: Type) => (b: Type) => m a -> (a -> m b) -> m b 
      };

let ListF
    : Functor List
    = { map: mapL };


using ListF; // explicitly bring ListF into implicit scope
// NOTE: multiple implicits can be in scope at once, but the compiler will issue a warning if multiple values of the same type are used.
// In practice, it means using `using` inside nested scopes is discouraged but possible as the compiler will give you feedback.
   
let simple
    : (String -> Num) -> List String -> List Num
    = ListF.map;

let implicitFunctor
    : (f: Functor List) => (Num -> String) -> List Num -> List String 
    = f.map; // implicit f is in scope
    
    
let poly
    : (t: Type -> Type) => (f: Functor t) => (String -> Num) -> t String -> t Num
    = f.map; // use implicits for easy polymorphism
    
    
let foo
    : (Num -> String) -> List Num -> List String
    = implicitFunctor; // type forces implicit resolution of Functor List, and it finds ListF

// NOTE: implicits are never carried over module boundaries. You must always manually bring them into scope with `using`.
// The LSP informs which implicit has been resolved, but it is usually obvious. 
// In addition, if you want to use a different value, you can always explictly pass it via `@` syntax, e.g. `implicitFunctor @AnotherListFunctor f xs`.
    
    
foreign print: String -> Unit;
foreign stringify: a -> String; // hack for illustration purposes
let block
  : Num -> Unit // Notice no IO type, but this is still effectful
  = \x -> {
    print "hello world!";
    let x = 1;
    print (stringify x);
    let tmp = 1 + x;
    print (stringify tmp);
    
    foo stringify one; // we're discarding the result here! but it still runs strictly, just like everything else 

    return *; 
  };


let row
  : Row 
  = [x: 1, y: "one"]; // Row:Type, rows are always types, we can never construct runtime values of row type. 

let tuple
  : { Num, String } // merely sugar for { 0: Num, 1: String }
  = { 1, "one" };
let struct
  : { x: Num, y: String } 
  = { x: 1, y: "foo" };

let map
  : { [String]: Num } // sugar for FFI.Indexed String Num @strategy, where strategy is some indexing implementation (hashmap, btree, vtable, etc)
  = { one: 1, two: 2, three: 3 };

let array
  : { [Num]: Num } // sugar for FFI.Indexed Num Num @defaultArray, where defaultArray is a basic contiguous array implementation
  = [1, 2, 3];

// NOTE: Now that we know about Rows, Variants are based on rows too! we use the # syntax to denote the tag, which is just a label in a row.

  
let NatRec // Peano natural numbers
    : Type
    = | #Z Unit | #S NatRec;

let n: NatRec = #S (#S (#Z *));

// Num can be negative, we don't enforce Nat here, so typechecking can diverge (infinite loop!). 
// We could add a catch-call case manually, but leaving it for pedagogical purposes. 
// Compiler will error out after 1000 iterations. The value is configurable.
// This encoding is usually done with the above Peano style, as it guarantees termination.
// However, this is more illustrative, practical and closer to real world usage.
let Vec 
  : Num -> Type -> Type
  = \n -> \t -> match n
  | 0 -> Unit
  | l -> {t, Vec (l - 1) t};
  
let vec0: Vec 0 Num = *;
let vec1: Vec 1 Num = {10, vec0};
let vec2: Vec 2 Num = {20, vec1};
let vec3: Vec 3 Num = {30, vec2};
// NOTE: Allowing termination metrics only at type level is under consideration but unlikely as it adds totality concerns to user code for little benefit.
// The compiler already produces informative errors that make debugging trivial. 



let Array
  : Type -> Type
  = \a -> { [Num]: a };

// We can defer polymorphic implementations to foreign code. Usually types are erased at runtime and we monomorphize. 
// You only need to worry about this if you want to provide a runtime with runtime type information (RTTI). Reflection is planned.
foreign prepend: (a: Type) => a -> Array a -> Array a; 

let ArrayF
  : Functor Array
  = { map: \f -> \xs -> match xs
    | [] -> []
    | [x | xs] -> prepend (f x) (:map f xs) // :map is recursive call to map property itself
    };
    
    


let Nat
    : Type
    = Num [|\n -> n > 0 |]; // We can refine a type with a predicate over its values


// These are checked statically. For example, you can never construct a value of type Pos that is not > 1. 
// Similarly, a value of type Pos can never be used where a Nat is expected, because Nat could be 0 or 1, violating the Pos invariant.
let Pos
    : Type
    = Num [|\p -> p > 1 |]; 


let blockWithRefinement
    : Nat
    = { 
        let f: Nat -> Pos
            = \o -> o + 1;
        return (f 1);  // typechecks! f guarantees output > 1 when input is > 0. The compiler knows that `+ 1` preserves the Nat -> Pos property
    };

let inc
    : (x: Num) -> Num [|\v -> v == (x + 1) |] // We can be exact about the output value too
    = \x -> x + 1;

let incf
    : (x: Nat) -> Nat
    = \x -> {
        let tmp
            : (Nat -> Nat) -> Nat
            = \f -> (f x) + 1; // tmp promises to return a Nat when given a Nat -> Nat function. This is valid by a logic similar to the above example
        return tmp inc; // inc is typed as (Num) -> Num, but contravariance allows us to use it where (Nat) -> Nat is expected, without violating any properties
    };

let n: Nat = 100; // obvious!
let result = inc n; // inferred to Num [| v -> v == 101 |]

let z: Nat = 0; // type error! 0 is not > 0
let r: Nat = inc 0; // works! inferred to Num [| v -> v == 1 |], which obivously satisfies Nat

let hof
    : (f: Nat -> Nat) -> Nat
    = \f -> f 1; // works for any f that takes Nat and returns Nat

let hof2
    : (Num -> Nat) -> Pos
    = \f -> (f 1) + 1; // works! f may take any number, but it guarantees to return a Nat, so adding 1 ensures Pos


let record
    : { a: Nat, b: Pos }
    = { a: 10, b: 2 }; // works! 10 > 0 and 2 > 1, every field must satisfy its refinement. NOTE: refinements on the record type itself are not currently supported


let id = \x -> x;

let s: String = id "hello";
let n = id 42; 