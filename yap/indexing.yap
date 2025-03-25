(* 

foreign Indexed: (k: Type) -> (v: Type) -> (Strategy k) => Type *)

(* 
let Indexing
    : (k: Type) -> (v: Key) -> Type
    = \k -> 
        { value: Type
        , init: Unit -> data :value
        , lookup: k -> data :value -> Maybe :value
        , insert: k -> :value -> data :value -> data :value 
        , delete: k -> data :value -> data :value
        , update: k -> (:value -> :value) -> data :value -> data :value
        }
        where data v = Indexed k v @(Strategy k) 
 *)


(* foreign Array: (Strategy Num) => (v: Type) -> Indexing Num v
foreign Dict: Type -> Indexed String Type *)



foreign Indexed: (k: Type, Strategy k) => Type

foreign Array: (v: Type) -> Indexed @(Num, Strategy Num) v

let Strategy
    : (k: Type) -> Type
    = \k -> 
        { data: Type // underlying data structure
        , init: (v: Type) => Unit -> :data v
        , lookup: (v: Type) => k -> :data v -> Maybe v
        , insert: (v: Type) => k -> v -> :data v -> :data v
        , delete:  (v: Type) => k -> :data v -> :data v
        , update: (v: Type) => k -> (v -> v) -> :data v -> :data v
        }

foreign c_newHashMap: (t: Type) => Unit -> List t;
foreign c_lookupHashMap: (t: Type) => String -> List t -> Maybe t;
foreign c_insertHashMap: (t: Type) => String -> t -> List t -> List t;
foreign c_deleteHashMap: (t: Type) => String -> List t -> List t;
foreign c_updateHashMap: (t: Type) => String -> (t -> t) -> List t -> List t;

let c_defaultHashMap
    :  Strategy String
    = { data: C.LinkedList
      , init: c_newHashMap 
      , lookup: c_lookupHashMap 
      , insert: c_insertHashMap
      , delete: c_deleteHashMap 
      , update: c_updateHashMap 
      }

let defaultHashMap
    : Strategy String
    = { data: List
      , init: JS.ini
      , lookup: \k -> \m -> m[k]
      , insert: \k -> \v -> \m -> { ...m, k: v }
      , delete: \k -> \m -> { ...m, k: undefined }
      , update: \k -> \f -> \m -> { ...m, k: f(m[k]) }
      }

let map
      : Indexed @(String, c_defaultHashMap) Num