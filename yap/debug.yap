export *;



let Nat
    : Type
    = Num [|\n -> n > 0 |];

let liquidInc
    : (x: Num) -> Num [|\v -> v == (x + 1) |]
    = \x -> x + 1;    

let liquidIncf
    : (x: Nat) -> Nat
    = \x -> {
        let tmp
            : (Nat -> Nat) -> Nat
            = \f -> (f x);
        return tmp liquidInc;
    };
