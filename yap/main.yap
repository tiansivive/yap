export *;
import "lib.yap";


foreign print: String -> Unit;

using ListF;

let main
  : (String -> Num) -> List String -> List Num
  = ListF.map;



let implicit
  : (f: Functor List) => (Num -> String) -> List Num -> List String 
  = f.map;


let foo
  : (Num -> String) -> List Num -> List String
  = implicit;

let bar
  : Unit
  = print "Hello, World!";

let block
  : Unit
  = {
    print "1";
    print "2";
    print "3";
  };

