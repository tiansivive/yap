export *;


let Nat1
    : Type
    = | #Z Unit | #S Nat1;

let n: Nat1 = #S (#S (#Z *));