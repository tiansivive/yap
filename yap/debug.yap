export *;



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

let simple
    : (String -> Num) -> List String -> List Num
    = ListF.map;

let implicitFunctor
    : (f: Functor List) => (Num -> String) -> List Num -> List String 
    = f.map;
    
    
let poly
    : (t: Type -> Type) => (f: Functor t) => (String -> Num) -> t String -> t Num
    = f.map;
    
    
let foo
    : (Num -> String) -> List Num -> List String
    = implicitFunctor;
