export *;

let Nat
    : Type
    = Num [|\n -> n > 0 |];

let hof
    : (f: Nat -> Nat) -> Nat
    = \f -> f 1;


