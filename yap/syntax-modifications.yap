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


-*>
~>
->
>-
->>
>>-


Sql.From "blah"
    |> where (fun x -> x > 10)
    |> rename "key" "id"
    |> sort "date" Asc
    |> limit 100

Sql.From "blah"
    >- where (fun x -> x > 10) 
    >- rename "key" "id"
    >- sort "date" Asc
    >- limit 100


/*************** IDEAS *****************/
let ex
    : Type
    = Nat %1 <!Async>


let Async : Effect
  

let await: (t: Type) => (t <Async>) -> t
    = \t -> \op -> {
        k v <- reset op;    // handling the effect. `Reset` takes a callback with the continuation k and the value v produced by the effect. `<-` is sugar for unnesting the callback.
        <???>               // async handling logic here. In this case, perform that before calling the continuation k. 
        k v;                // calling the continuation with the value v
    }

let fire: (t: Type) => (t <Async>) -> (t -> Unit) -> Unit
    = \t -> \op -> \cb -> {
        k v <- reset op;    // handling the effect. `Reset` takes a callback with the continuation k and the value v produced by the effect. `<-` is sugar for unnesting the callback.
        k v;                // calling the continuation with the value v
        <???>               // async handling logic here, which will call `cb` with v. In this case, we perform that after calling the continuation k.
    }

let foo 
    : () -> Unit
    = () -> {
        print("Begin")
        await (sleep 1000) // instantiate `t` to `Unit`. we discard the result
        print("Slept for 1 second");
    }

let bar 
    : () -> Unit 
    = () -> {
        fire (sleep 1000) None
        print("Begin");
    }

let baz 
    : () -> Unit 
    = () -> {
        fire (sleep 1000) (Some \_ -> print("Slept for 1 second"))
        print("Begin");
    }