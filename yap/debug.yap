export *;

let Vec 
  : Num -> Type -> Type
  = \n -> \t -> match n
  | 0 -> Unit
  | l -> {t, Vec (l - 1) t};
  
let vec0: Vec 0 Num = *;

let vec1: Vec 1 Num = {10, vec0};
let vec2: Vec 2 Num = {20, vec1};
let vec4: Vec 4 Num = {30, vec2};