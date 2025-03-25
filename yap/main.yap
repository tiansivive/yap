export *;
import "lib.yap";




let Array
  : Type -> Type
  = \a -> Indexed Num a;


foreign prepend: (a: Type) => a -> Array a -> Array a;

let mapA 
  : (a: Type) => (b: Type) => (a -> b) -> Array a -> Array b
  = \f -> \xs -> match xs
    | [] -> []
    | [x | xs] -> prepend (f x) (mapA f xs);

let ArrayF
  : Functor Array
  = { map: mapA };