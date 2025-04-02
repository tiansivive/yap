export *;

 

foreign Coerce: Type -> Type -> Type



// it's FFI, so no guarantee that it's correct. We leverage that to cast types when required by the target platform
foreign $c_int64: Any -> Int 64 

let LUB
    : Type -> Type -> Type
    = \a b -> { lub: Type, fst: a -> :lub, snd: b -> :lub }

let Numerical
    : Type -> Type
    = \a -> 
        { add: a -> a -> a
        , sub: a -> a -> a
        , mul: a -> a -> a
        , div: a -> a -> a 
        }
    

let PrecisionArithmeticOp: Type => Type 
    = \t => (t -> t -> t)
foreign $addInt: (p: Int) -> PrecisionArithmeticOp (Int p)
foreign $subInt: (p: Int) -> PrecisionArithmeticOp (Int p)
foreign $mulInt: (p: Int) -> PrecisionArithmeticOp (Int p)
foreign $divInt: (p: Int) -> PrecisionArithmeticOp (Int p)

let NumInt
    : (precision: Int) -> Numerical (Int precision)
    = \p -> 
        { add: \x y -> $addInt p x y
        , sub: \x y -> $subInt p x y
        , mul: \x y -> $mulInt p x y
        , div: \x y -> $divInt p x y
        }

let NumInt32: Numerical (Int 32) = NumInt 32
let NumInt64: Numerical (Int 64) = NumInt 64
let lubInt32Int64
    : LUB (Int 32) (Int 64) 
    = { lub: Int 64, fst: $c_int64, snd: $c_int64 } 


let (+)
    : (a: Type) => (b: Type) => ({lub, fst, snd}: LUB) => (nc: Numerical lub) => a -> b -> lub 
    = \x y -> nc.add (fst x) (snd y) 

    
using (NumInt32, NumInt64, lubInt32Int64) {
    let x: Int 32 = 1;
    let y: Int 64 = 2;
    let z = x + y;
    let w = y + x;
    let v = x + x;
    let u = y + y;
}


let reflectExample
    : (a: Type) => (b: Type) => (rfA: Reflect a) => (rfB: Reflect b) => a | b -> Int
    = \t -> match typeof t
        | Num -> 1
        | String -> 2

let Reflect
    : Type -> Type
    = \t -> { typeof: t -> Type };

let rfNum
    : Reflect Num
    = { typeof: \_ -> Num };

let rfString
    : Reflect String
    = { typeof: \_ -> String };

let rfNumString
    : Reflect (Num | String)
    = { typeof: reflect Num String rfNum rfString };

let Maybe
    : Type -> Type
    = \a -> | #none Unit | #some a;

let Strategy
    : (k: Type) -> Type
    = \k -> 
        { value: Type
        , init: Unit -> data :value
        , lookup: k -> data :value -> Maybe :value
        , insert: k -> :value -> data :value -> data :value 
        , delete: k -> data :value -> data :value
        , update: k -> (:value -> :value) -> data :value -> data :value
        }
        where data v = Indexed k v @(Strategy k) 

foreign Indexed: (k: Type) -> (v: Type) -> (Strategy k) => Type

foreign Array: Type -> Indexed Num Type
foreign Dict: Type -> Indexed String Type

let c_defaultHashMap
    : Type -> Strategy String
    = \t -> 
        { value: t
        , init: \_ -> c_newHashMap t ()
        , lookup: \k -> c_lookupHashMap k
        , insert: \k v -> c_insertHashMap k v
        , delete: \k -> c_deleteHashMap k
        , update: \k f -> c_updateHashMap k f
        } 


foreign Row: Type -> Type
foreign Schema: Row Type -> Type
foreign Tuple: Row Type -> Type



foreign c_newHashMap: (t: Type) -> Unit -> Indexed String t;
foreign c_loo




        

let map
  : Indexed String Num @c_defaultHashMap
  = { one: 1, two: 2, three: 3 };

let list
  : Indexed Num Num @defaultArray
  = [1, 2, 3];







let array
    : { [Num]: String, foo: String, bar: Num } // Indexed Num String & Schema []
    = { 1: "one", 2: "two", 3: "three", foo: "foo", bar: 1 };









foreign Row: Type -> Type -> Type

foreign Schema: (Storage row) => row -> Type
    where row = Row String Type;
let struct
    // desugared: Schema @defaultHashMap [x: Num, y: String]
    : { x: Num, y: String }
    = { x: 1, y: "one" };

foreign Tuple: (Storage row) => row -> Type
    where row = Row Num Type;
let tuple
    // desugared: Tuple @defaultArray [0: Num, 1: String] 
    : { Num, String }
    = { 1, "one" };


foreign Map: (Storage row) => row -> Type
    where row = Row Type Type;
let array
    // desugared: Map @defaultArray [Num: String]
    : Indexed Num String
    = ["one", "two", "three"];

let dict
    // desugared: Map @defaultHashMap [String: Num]
    : { [String]: Num }
    = { one: 1, two: 2, three: 3 };

foreign MultiMap: (Storage row) => row -> Type
    where row = Row (Row Num Type) Type;
let multi
    // desugared:  MultiMap @defaultTrie [[Num, Num]: String, [String, String]: Num, [String, Num]: Unit]
    : { [Num, Num]: String, [String, String]: Num, [String, Num]: Unit  }  
    = { { 1, 1 }: "one"
      , { 2, 2 }: "two"
      , { "foo", "bar" }: 1 
      , { "foo", "baz" }: 2
      , { "qux", 1 }: * // unit value
      , { "quz", 2 }: * // unit value
      };


let Storage
    : Type -> Type
    = \row -> match row
        | Row index value -> 
            { get: index -> value
            , set: index -> value -> row
            , empty: row
            , insert: index -> value -> row -> row
            , delete: index -> row -> row
            , update: index -> (value -> value) -> row -> row
            , lookup: index -> row -> Maybe value
            }
        | _ -> TypeError "Storage expects a Row";

let defaultArray
    : Storage (Row Num Type)
    = { get: get, set: set, empty: empty, insert: insert, delete: delete, update: update, lookup: lookup }
    where 
        // implement get, set, empty, insert, delete, update, lookup

let defaultHashMap
    : Storage (Row String Type)
    = { get: get, set: set, empty: empty, insert: insert, delete: delete, update: update, lookup: lookup }
    where 
        // implement get, set, empty, insert, delete, update, lookup





let Functor
    : (Type -> Type) -> Type
    = \f -> { map: (a: Type) => (b: Type) => (a -> b) -> f a -> f b };
    
let Monad
    : (Type -> Type) -> Type
    = \m -> 
      { of: (a: Type) => a -> m a
      , bind: (a: Type) => (b: Type) => m a -> (a -> m b) -> m b 
      };

let List
    : Type -> Type
    = \a -> | #nil Unit | #cons { a, List a };

let ListF
    : Functor List
    = { map: \f -> \l -> match l
        | #nil _            -> #nil *
        | #cons { x, xs }   -> #cons { f x, :map f xs } 
    };


let infer
    : (ctx::{ :env, :imports }: Context, M: Elaboration) => AST -> M.Elaboration Num 
    = \ast -> match ast
        | #Lit lit -> M.of { #Lit lit, #Lit atom, Q.noUsages env.length } 
            where atom = #Lit match lit
                | #Num n    -> #Lit #Atom "Num"
                | #String s -> #Lit #Atom "String"
                | #Bool b   -> #Lit #Atom "Bool"
                | #Unit     -> #Lit #Atom "Unit"
                | #Atom     -> #Lit #Atom "Type"
            
        | #Proj { :term, :label } -> M.Do
            |> M.let "term" (infer term)
            |> M.bind "inferred" (\{ term: {tm, ty, us} } -> EB.project label tm ty us)
            |> M.fmap \{ term: { tm, ty, us } } -> { #Proj label tm, inferred, us }


        | #Inj { :label, :value, :term } -> {
            \value::{ nf,, u1 } <- M.chain (infer value);
            \term::{ tm, u2 } <- M.chain (infer term);
            \inferred <- M.chain (EB.inj label value term);
            return M.of { #Inj label value term, inferred, u1 + u2 };
        }

        | #Annotation { :term, :ty, :q } -> using M.monad {
            \{ nf, u1 } <- check ty NF.#Type;
            \{ ty, u2 } <- M.of { NF.evaluate env imports ty, u1 };
      
            \{ tm } <- check term ty;
            return M.of { tm, ty, u2 };
        }



// testing pipeline

let pipeline = \x y -> y
    |> foo
    |> bar x
    |> baz x

let sugar = \x 
    >> foo
    |> bar x
    |> baz x     

let omit = 
    \>> foo
    |> bar
    |> baz



// backcalls

let foo = \payload -> {
    \res1 <- fetch url payload
    \res2 <- fetch url payload
    \res3 <- fetch url payload
    \res4 <- fetch url payload
    return res1 + res2 + res3 + res4
}   err -> handle err