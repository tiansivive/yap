

let List
    : Type -> Type
    = \a -> | nil: a | cons: { a, List a };


let Functor
    : (Type -> Type) -> Type
    = \f -> { map:: (a: Type) -> (b: Type) -> (a -> b) -> f a -> f b };

let foo
    : (a: Type) => (b: Type) => (a -> b) -> List a -> b
    = \f -> \l -> match l
        | nil: x            -> f x
        | cons: { x, xs }   -> foo f xs;



let mapList
    : (a: Type) -> (b: Type) -> (a -> b) -> List a -> List b
    = \a -> \b -> \f -> \l -> match l
        | nil: x            -> :nil f x
        | cons: { x, xs }   -> :cons { f x, mapList a b f xs };

