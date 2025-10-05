let empty: List Num = #nil *;
let one: List Num = #cons { 1, empty };


// or `] x: 1, y: "one" [` ???
let row
  : (x: Num, y: String)
  = (x: 1, y: "one");

let struct
  : { x: Num, y: String }  (** Sugar for `Schema (x: Num, y: String)`  *)
  = { x: 1, y: "foo" };

let tuple
  : { Num, String } (** Sugar for `Schema (0: Num,1: String)` **)
  = { 1, "one" };

let map
  : [ String: Num ] (** Sugar for `Indexed String Num @defaultMap, with defaultMap being the indexing strategy **)
  = [ one: 1, two: 2, three: 3 ];

let array
  : [ Num: String ] (** Sugar for `Indexed Num String @defaultArray, with defaultArray being the indexing strategy **)
  = [ "one", "two", "three" ];

let project: Num = struct.x;
let project_row: String = row.y;
let project_tuple: String = tuple.1;

let index_map: Num = map[two];
let index_array: String = array[2];

let inject: typeof struct & { z: Bool } = { struct | z = true };
let inject_row: typeof row & { z: Bool } = ( row | z = true );
let inject_tuple: typeof tuple & { Bool } = ( tuple | true );
let update_tuple: typeof tuple = ( tuple | 1 = "uno" );

let inject_map: typeof map = [ map | foo = 11 ];
let inject_array: typeof array  = [ array | "four" ];
let update_map: typeof map = [ map | two = "duo" ];

