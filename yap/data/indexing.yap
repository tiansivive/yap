export *;

let Strategy
    : (k: Type) -> Type
    = \k -> 
        { data: Type
        , init: Unit -> :data
        , lookup: (v: Type) => k -> :data -> Maybe v
        , insert: (v: Type) => k -> v -> :data -> :data
        , delete: (v: Type) => k -> :data -> :data
        , update: (v: Type) => k -> (v -> v) -> :data -> :data
        }


let JS_hashmap
    : Strategy String
    = { data: { buckets: JS.Array, size: Num }
      , init: JS.mkObject
      , lookup: JS.get
      , insert: JS.set
      , delete: JS.delete
      , update: JS.update
      } 