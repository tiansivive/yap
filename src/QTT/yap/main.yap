export *;
import "lib.yap";

using ListF;

let main
  : (String -> Num) -> List String -> List Num
  = ListF.map;



let try
  : (f: Functor List) => (Num -> String) -> List Num -> List String 
  = f.map;


let foo
  : (Num -> String) -> List Num -> List String
  = try;