export *;


let Functor
    : (Type -> Type) -> Type
    = \f -> { map: (a: Type) => (b: Type) => (a -> b) -> f a -> f b };
    
let Monad
    : (Type -> Type) -> Type
    = \m -> 
      { of: (a: Type) => a -> m a
      , bind: (a: Type) => (b: Type) => m a -> (a -> m b) -> m b 
      };

let List
    : Type -> Type
    = \a -> | #nil Unit | #cons { a, List a };


let mapL
    : (a: Type) => (b: Type) => (a -> b) -> List a -> List b
    = \f -> \l -> match l
        | #nil _            -> #nil *
        | #cons { x, xs }   -> #cons { f x, mapL f xs };
     

let ListF
    : Functor List
    = { map: mapL };

