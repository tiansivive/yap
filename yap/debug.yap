export *;

let Nat
    : Type
    = Num [|\n -> n > 0 |];

let one
    : Num [|\v -> v == 1 |]
    = 1;

let inc
    : (n: Num) -> Num [|\o -> o == (n + 1) |]
    = \x -> x + 1;    


 
 