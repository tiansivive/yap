import "./list.yap" as L;


let Entry
  : Type -> Type -> Type
  = \k v -> { key: k, value: v };

let HashMap
  : (f: Type -> Type) => Type -> Type -> Type
  = \k v -> { buckets: f (Entry k v), count: Num };



let hash
  : String -> Num -> Num
  = \key s -> Str.reduce key 0 (\acc char -> acc + Char.code char) % s;

let empty
  : Unit -> HashMap @L.List String Num
  = \_ -> { buckets: #nil *, count: 0 };



let defaultStrategy = {
  data: RTS.Array,
  init: empty,
  lookup: \k -> \m -> match m
    | #nil _ -> #none *
    | #cons { key, value } | #cons { key, value, _ } -> if key == k then #some value else lookup k m,
  insert: \k -> \v -> \m -> #cons { key: k, value: v, m },
  delete: \k -> \m -> match m
    | #nil _ -> #nil *
    | #cons { key, value } | #cons { key, value, _ } -> if key == k then m else #cons { key: key, value: value, delete k m },
  update: \k -> \f -> \m -> match m
    | #nil _ -> #nil *
    | #cons { key, value } | #cons { key, value, _ } -> if key == k then #cons { key: key, value: f value, m } else #cons { key: key, value: value, update k f m }
};