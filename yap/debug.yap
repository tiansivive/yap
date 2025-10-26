export *;


let Vec
    : Num -> Type -> Type
    = \n -> \t -> match n
        | 0 -> Unit
        | l -> {t, Vec (l - 1) t};

let vec0: Vec 0 Num = *;

let vec1: Vec 1 Num = {10, vec0};

let vec2: Vec 2 Num = {20, vec1};

let vec3: Vec 3 Num = {30, vec2};


let List
    : Type -> Type
    = \a -> | #nil Unit | #cons { a, List a };


let empty: List Num = #nil *;
let one: List Num = #cons { 1, empty };

  
let Nat1
    : Type
    = | #Z Unit | #S Nat1;

let n: Nat1 = #S (#S (#Z *));


let Functor
  : (Type -> Type) -> Type
  = \f -> { map: (a: Type) => (b: Type) => (a -> b) -> f a -> f b };
  
let Array
  : Type -> Type
  = \a -> { [Num]: a };
  
foreign prepend: (a: Type) => a -> Array a -> Array a;
let ArrayF
  : Functor Array
  = { map: \f -> \xs -> match xs
    | [] -> []
    | [x | xs] -> prepend (f x) (:map f xs)
    };
    
    