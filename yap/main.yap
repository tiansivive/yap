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


let poly
  : (t: Type -> Type) => (f: Functor t) => (String -> Num) -> t String -> t Num
  = f.map;


let foo
  : (Num -> String) -> List Num -> List String
  = implicit;



let block
  : Num -> Unit
  = \x -> {
    print "1";
    print "2";
    print "3";
  };


let empty: List Num = #nil *;
let one: List Num = #cons { 1, empty };

let tuple
  : { Num, String } 
  = { 1, "one" };
let row
    : [x: Num, y: String]
    = [x: 1, y: "one"];
let struct
  : { x: Num, y: String } 
  = { x: 1, y: "foo" };

let map
  : Indexed String Num
  = { one: 1, two: 2, three: 3 };
