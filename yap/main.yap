export *;
import "lib.yap";




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
    
    
