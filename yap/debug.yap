export *;

let Nat
    : Type
    = Num [|\n -> n > 0 |];

let Pos
    : Type
    = Num [|\p -> p > 1 |];

let inc
    : (x: Num) -> Num [|\v -> v == (x + 1) |]
    = \x -> x + 1;

let incf
    : (x: Nat) -> Pos
    = \x -> {
        let tmp
            : (f: Nat -> Nat) -> Pos
            = \f -> (f x) + 1;
        return tmp inc;
    };
