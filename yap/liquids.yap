

let Nat
    : Type
    = Num [|\n -> n > 0 |];

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

let inc
    : (x: Num) -> Num [|\v -> v == (x + 1) |]
    = \x -> x + 1;

let incf
    : (x: Nat) -> Pos
    = \x -> {
        let tmp
            : (Nat -> Nat) -> Pos
            = \f -> (f x) + 1;
        return tmp inc;
    };


let n: Int [| n > 0 |] = 100;
let result = inc n; 

let z: Nat = 0;
let r: Nat = inc 0;

let hof
    : (f: Nat -> Nat) -> Nat
    = \f -> f 1;

let hof2
    : (Num -> Nat) -> Pos
    = \f -> (f 1) + 1;

