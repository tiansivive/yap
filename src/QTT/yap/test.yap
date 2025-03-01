

let List
    : Type -> Type
    = \a -> (| nil: Unit | cons: { a, List a });

let map
    : (Num -> String) -> List Num -> List String
    = \f -> \l -> match l
        | nil: _        -> :nil *
        | cons: {x, xs} -> :cons { f x, map f xs };



