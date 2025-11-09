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



