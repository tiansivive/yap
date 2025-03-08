export *;
import "lib.yap";


let main
  : (String -> Num) -> List String -> List Num
  = ListF.map; 