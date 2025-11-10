export *;


let inc
    : (x: Num) -> Num [|\v -> v == (x + 1) |]
    = \x -> x + 1;

let x: Num [|\v -> v == 2 |] = inc 1;

let incf
    : (x: Num) -> Num
    = \x -> {
        let tmp
            = \f -> (f x) + 1;
        return tmp inc;
    };

let i = (\n:Num => \x:String -> x) "hello";

let id = \x -> x;

let n = id 42;
let s = id "hello";

let test = {
    let id2 = \y -> y;
    id2 5;
    id2 "world";
    return 1;
};
