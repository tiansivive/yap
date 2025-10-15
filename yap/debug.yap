export *;

let Nat
    : Type
    = Num [|\n -> n > 0|];

let inc
    : (x:Nat) -> Num
    = \x -> x;


let r = inc 0;