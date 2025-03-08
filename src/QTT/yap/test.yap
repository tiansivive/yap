

let List
    : Type -> Type
    = \a -> | nil: Unit | cons: { a, List a };


let Functor
    : (Type -> Type) -> Type
    = \f -> { map: (a: Type) => (b: Type) => (a -> b) -> f a -> f b };


let mapList
    : (a: Type) => (b: Type) => (a -> b) -> List a -> List b
    = \f -> \l -> match l
        | nil: _            -> #nil *
        | cons: { x, xs }   -> #cons { f x, mapList f xs };

let ListF
    : Functor List
    = { map: mapList };


let foo
    : (Num -> String) -> List Num -> List String
    = \f -> ListF.map f;
