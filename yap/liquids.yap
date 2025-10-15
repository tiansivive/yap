
let inc
    : (x:Int [| x > 10 |]) -> (y: Int [| y == x + 1 |])
    = \x -> x + 1;


let n: Int [| n > 0 |] = 100;

let result = inc n; 



let Nat
    : Type
    = Num [|\n -> n > 0|];

let z: Nat = 0;

let inc
    : (x:Nat) -> Num [|\v -> v == (x + 1)|]
    = \x -> x + 1;


let r: Nat = inc 0;