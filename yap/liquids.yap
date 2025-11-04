

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

let hof3
    : Num -> (Num -> Num) -> Num
    = \x -> \f -> (f x) + 1;


           (and 
            (forall (($b Real)) (=> (= $b 1.0) true)) 
            (forall ((x Real))              
                (=> (> x 0.0) 
                    (forall ((y Real)) 
                        (=> (= y 1.0) 
                            (forall (($c Real)) (=> (= $c (+ y x)) (< y $c)))) 
                    )
                )
            )
        )
    let posTestCheckLiteral
    : Num [|\v -> v == 1 |]
    = 1;

let negTestCheckLiteral
    : Num [|\v -> v == 1 |]
    = 2;


let negFnApp
    : Num [|\v -> v == 0 |]
    = 1 + 2;

let posTestCheckLambdaPostCondition
    : Num -> Num [|\v -> v == 1 |] 
    = \x -> 1;

let negTestCheckLambdaPostCondition
    : Num -> Nat
    = \x -> x;

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

let nonANF
    : Num
    = (inc 1) + 1;

let hof2
    : (Num -> Num) -> Num
    = \f -> f 1 + 1;


