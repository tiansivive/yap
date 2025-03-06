module Lib exports fn;

let List
    : Type -> Type
    = \a -> (| nil: Unit | cons: { a, List a });

let Functor
    : (Type -> Type) -> Type
    = \f -> { map:: (a:Type) -> (b: Type) -> (a -> b) -> f a -> f b };


let mapL
    : (a:Type) -> (b: Type) -> (a -> b) -> List a -> List b
    = \a -> \b -> \f -> \l -> match l
        | nil: _        -> :nil *
        | cons: {x, xs} -> :cons { f x, mapL a b f xs };

