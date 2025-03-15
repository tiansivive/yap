export *;





let reflect
    : (a: Type) => (b: Type) => (rfA: Reflect a) => (rfB: Reflect b) => a | b -> String
    = \t -> match typeof t
        | Num -> "Num"
        | String -> "String"

let Reflect
    : Type -> Type
    = \t -> { typeof: t -> Type };

let rfNum
    : Reflect Num
    = { typeof: \_ -> Num };

let rfString
    : Reflect String
    = { typeof: \_ -> String };

let rfNumString
    : Reflect (Num | String)
    = { typeof: reflect Num String rfNum rfString };


foreign Indexed: Type -> Type -> Type
foreign Row: Type -> Type


foreign Schema: Row Type -> Type
foreign Tuple: Row Type -> Type


foreign Array: Type -> Indexed Num Type
foreign Dict: Type -> Indexed String Type

let array
    : { [Num]: String, foo: String, bar: Num } // Indexed Num String & Schema []
    = { 1: "one", 2: "two", 3: "three", foo: "foo", bar: 1 };









foreign Row: Type -> Type -> Type

foreign Schema: (Storage row) => row -> Type
    where row = Row String Type;
let struct
    // desugared: Schema @defaultHashMap [x: Num, y: String]
    : { x: Num, y: String }
    = { x: 1, y: "one" };

foreign Tuple: (Storage row) => row -> Type
    where row = Row Num Type;
let tuple
    // desugared: Tuple @defaultArray [0: Num, 1: String] 
    : { Num, String }
    = { 1, "one" };


foreign Map: (Storage row) => row -> Type
    where row = Row Type Type;
let array
    // desugared: Map @defaultArray [Num: String]
    : { [Num]: String }
    = ["one", "two", "three"];

let dict
    // desugared: Map @defaultHashMap [String: Num]
    : { [String]: Num }
    = { one: 1, two: 2, three: 3 };

foreign MultiMap: (Storage row) => row -> Type
    where row = Row (Row Num Type) Type;
let multi
    // desugared:  MultiMap @defaultTrie [[Num, Num]: String, [String, String]: Num, [String, Num]: Unit]
    : { [Num, Num]: String, [String, String]: Num, [String, Num]: Unit  }  
    = { { 1, 1 }: "one"
      , { 2, 2 }: "two"
      , { "foo", "bar" }: 1 
      , { "foo", "baz" }: 2
      , { "qux", 1 }: * // unit value
      , { "quz", 2 }: * // unit value
      };


let Storage
    : Type -> Type
    = \row -> match row
        | Row index value -> 
            { get: index -> value
            , set: index -> value -> row
            , empty: row
            , insert: index -> value -> row -> row
            , delete: index -> row -> row
            , update: index -> (value -> value) -> row -> row
            , lookup: index -> row -> Maybe value
            }
        | _ -> TypeError "Storage expects a Row";

let defaultArray
    : Storage (Row Num Type)
    = { get: get, set: set, empty: empty, insert: insert, delete: delete, update: update, lookup: lookup }
    where 
        // implement get, set, empty, insert, delete, update, lookup

let defaultHashMap
    : Storage (Row String Type)
    = { get: get, set: set, empty: empty, insert: insert, delete: delete, update: update, lookup: lookup }
    where 
        // implement get, set, empty, insert, delete, update, lookup