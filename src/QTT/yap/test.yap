

let List
    : Type -> Type
    = \a -> (| nil: a | cons: {a, List a});



let mapList
    : (a: Type) => (b:Type) => (a -> b) -> List a -> List b
    = \f -> \l -> match l
        | nil: el -> :nil f el
        | cons: {el, ll} -> :cons { f el, mapList f ll }



let Functor = \(f: Type -> Type) -> { map:: (a:Type) -> (b:Type) -> (a -> b) -> f a -> f b };

let ListF
    : Functor List
    = { map: \a -> \b -> _};



