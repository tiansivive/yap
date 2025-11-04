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

let fn
    : Num -> Num
    = \x -> 2;

let posTestCheckLambdaPostCondition
    : Num -> Num [|\v -> v == 1 |] 
    = \x -> 1;

let negTestCheckLambdaPostCondition
    : Num -> Nat
    = \x -> x;


let posFnApp
    : Nat 
    = 1 + 2;

let negFnApp
    : Num [|\v -> v == 0 |]
    = 1 + 2;

let nested
    : Num
    = (fn 1) + 5;
    


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

let hof
    : (f: Num -> Num) -> Num
    = \f -> f 1;

let hof2
    : (Num -> Nat) -> Nat
    = \f -> (f 1) + 1;

let hof3
    : Num -> (Num -> Num) -> Num
    = \x -> \f -> (f x) + 1;


let Pos
    : Type
    = Num [|\p -> p > 1 |];


let incf
    : (x: Nat) -> Pos
    = \x -> {
        let tmp
            : (Num -> Nat) -> Pos
            = \f -> (f x) + 1;
        return tmp inc;
    };