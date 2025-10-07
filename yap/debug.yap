export *;


let List
    : Type -> Type
    = \a -> | #nil Unit | #cons { a, List a };


let mapL
    : (a: Type) => (b: Type) => (a -> b) -> List a -> List b
    = \f -> \l -> match l
        | #nil _            -> #nil *
        | #cons { x, xs }   -> #cons { f x, mapL f xs };
     