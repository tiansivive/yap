export *;


let row
  : Row
  = [x: 1, y: "one"];




let Record
    : Schema [: Type]

let list
  : { [Num]: String } // Schema [Num: String]
  = [1,2,3,4];



foreign Schema: Row Type -> Type

foreign Tuple: Row Type -> Type

foreign Array: Row (Indexed Type) -> Type


let row1
    : Row String Type
    = [x: String, y: Num];

let row2
    : Row Num Type
    = [1: String, 2: Num];

let row3
    : Row Num String
    = [1: "one", 2: "two"];


foreign Relation: Type -> Type -> Type
foreign Schema: Relation String Type -> Type

let struct
    : Schema [x: Num, y: String]
    = { x: 1, y: "one" };

foreign Tuple: Relation Num String -> Type
let tuple
    : Tuple [Num, String] // sugar for [0: Num, 1: String]
    = { 1, "one" };


foreign Dict: Relation (Type) Type -> Type
let dict
    : Dict [Num: String, foo: Num]
    = { 1: "one", 2: "two" };