export *;

let Nat
    : Type
    = Num [|\n -> n > 0 |];

let Pos
    : Type
    = Num [|\p -> p > 1 |];

let hof2
    : (Num -> Num) -> Pos
    = \f -> (f 1) + 1;


