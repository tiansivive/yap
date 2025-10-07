export *;


let List
    : Type -> Type
    = \a -> | #nil Unit | #cons { a, List a };


let mapL
    : (a: Type) => (b: Type) => (a -> b) -> List a -> List b
    = \f -> \l -> match l
        | #nil _            -> #nil *
        | #cons { x, xs }   -> #cons { f x, mapL f xs };
     

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


using ListF;
    
let main
    : (String -> Num) -> List String -> List Num
    = ListF.map;
    
    
let implicit
    : (f: Functor List) => (Num -> String) -> List Num -> List String 
    = f.map;
    
    
let poly
    : (t: Type -> Type) => (f: Functor t) => (String -> Num) -> t String -> t Num
    = f.map;
    
    
let foo
    : (Num -> String) -> List Num -> List String
    = implicit;
    
    
    
foreign print: String -> Unit;
let block
  : Num -> Unit
  = \x -> {
    print "1";
    print "2";
    print "3";
  };


let empty: List Num = #nil *;
let one: List Num = #cons { 1, empty };

let row
  : Row
  = [x: 1, y: "one"];
  
let tuple
  : { Num, String } 
  = { 1, "one" };
let struct
  : { x: Num, y: String } 
  = { x: 1, y: "foo" };

let map
  : { [String]: Num }
  = { one: 1, two: 2, three: 3 };

let array
  : { [Num]: Num }
  = [1, 2, 3];

  