export *;


let inc
    : (n: Num) -> Num
    = \x -> x + 1;

let incf
    : (x: Num) -> Num
    = \x -> {
        let tmp = \f -> (f x) + 1;
        return tmp inc;
    };

