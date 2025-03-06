


let foo
    : (a:Type) -> (b: Type) -> (a -> b) -> a -> b
    = \a -> \b -> \f -> \x -> f x;