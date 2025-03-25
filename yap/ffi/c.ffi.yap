import "core/data/list.yap";
export *;

let HashMap = {
  foreign new_hash_map: (t: Type) => Unit -> List t;
  foreign lookup_hash_map: (t: Type) => String -> List t -> Maybe t;
  foreign insert_hash_map: (t: Type) => String -> t -> List t -> List t;
  foreign delete_hash_map: (t: Type) => String -> List t -> List t;
  foreign update_hash_map: (t: Type) => String -> (t -> t) -> List t -> List t;
  
  let default_hash_map
    :  Strategy String
    = { data: C.LinkedList
      , init: new_hash_map 
      , lookup: lookup_hash_map 
      , insert: insert_hash_map
      , delete: delete_hash_map 
      , update: update_hash_map 
      }
  
  return { 
    default_hash_map: default_hash_map
  }
}
