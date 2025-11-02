export *;

let Nat
    : Type
    = Num [|\n -> n > 0 |];

let posTestCheckLiteral
    : Num [|\v -> v == 1 |]
    = 1;

let negTestCheckLiteral
    : Num [|\v -> v == 1 |]
    = 2;

let posTestCheckLambdaPostCondition
    : Num -> Num [|\v -> v == 1 |] 
    = \x -> 1;

let negTestCheckLambdaPostCondition
    : Num -> Num [|\v -> v == 1 |]
    = \x -> 2;


let posTestCheckLambdaPreCondition
    : (n: Nat) -> Num
    = \x -> x;

let posTestCheckLambdaPreAndPostCondition
    : (n: Nat) -> Nat
    = \x -> x;

let negTestCheckLambdaPreAndPostCondition
    : (n: Nat) -> Nat
    = \x -> 0;








let posTestCheckRefinedResultLambda
    : (n: Num) -> Num [|\o -> o == (n + 1) |]
    = \x -> x + 1;

let inc
    : (n: Num) -> Num [|\o -> o == (n + 1) |]
    = \x -> x + 1;    


 
 