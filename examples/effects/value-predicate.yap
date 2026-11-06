let positive = \v -> v > 0;

let x: Num [| \st -> positive |] = 5;
let y: Num [| \st v -> v > 0 |] = 5;
