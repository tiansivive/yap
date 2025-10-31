export *;



let Nat
    : Type
    = Num [|\n -> n > 0 |];

let inc
    : (x: Num) -> Num [|\v -> v == (x + 1) |]
    = \x -> x + 1;    

let liquidIncf
    : (x: Nat) -> Nat
    = \x -> {
        let tmp
            : (Nat -> Nat) -> Nat
            = \f -> (f x);
        return tmp inc;
    };


let Pos
    : Type
    = Num [|\p -> p > 1 |];


let block
    : Nat
    = { 
        let f: Nat -> Pos
            = \o -> o + 1;
        return (f 1); 
    };

let incf
    : (x: Nat) -> Pos
    = \x -> {
        let tmp
            : (Nat -> Nat) -> Pos
            = \f -> (f x) + 1;
        return tmp inc;
    };

let hof2
    : Num -> (Num -> Num) -> Num
    = \x -> \f -> (f x) + 1;
