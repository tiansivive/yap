export *;


let b: Bool = true;
let n: Num = 42;
let greeting: String = "Hello, Yap!";
let u: Unit = !;     


let add: Num -> Num -> Num
    = \x -> \y -> x + y;

let identity: Num -> Num
    = \x -> x;

let forty2 = identity 42;
let added = add 10 20;  

let compose: (Num -> Num) -> (Num -> Num) -> Num -> Num
    = \f -> \g -> \x -> f (g x);


let add1 = \x -> x + 1;
let add5 = \x -> x + 5;
let double = \x -> x * 2;

let add1ThenDouble = compose double add1;




let point: { x: Num, y: Num }
    = { x: 0, y: 10 };    

let person: { name: String, age: Num }
    = { name: "Alice", age: 30 };

let rectangle: { width: Num, height: Num, area: Num }
    = { width: 10, height: 20, area: :width * :height };

let xCoord = point.x;
let getX: { x: Num, y: Num } -> Num
    = \p -> p.x;
let point3d = { point | y = 20, z = 30 };


let pair: { Num, String }
    = { 42, "answer" };
let pairExplicit: { 0: Num, 1: String }
    = { 0: 42, 1: "answer" };


let array: { [Num]: Num }
    = [1, 2, 3];
let dict: { [String]: Num }
    = { one: 1, two: 2, three: 3 };


let TrafficLight: Type
    = | #red Unit | #yellow Unit | #green Unit;

let light: TrafficLight = #red !;
let unkownColor = #purple !;




let Shape: Type
    = | #circle Num
      | #rectangle { Num, Num }
      | #point { x: Num, y: Num };

let c: Shape = #circle 5.0;
let r: Shape = #rectangle { 10, 20 };
let p: Shape = #point { x: 0, y: 0 };


let isZero: Num -> Bool
    = \n -> match n
        | 0 -> true
        | _ -> false;

let getY: { x: Num, y: Num } -> Num
    = \p -> match p
        | { x: a, y: b } -> b;

let getY2: { x: Num, y: Num } -> Num
    = \p -> match p
        | { y: a } -> a;


let describeShape: Shape -> String
    = \s -> match s
        | #circle r             -> "Circle with radius"
        | #rectangle { w, h }   -> "Rectangle"
        | #point { x: _, y: _ } -> "Point at coordinates";


let firstOrZero: { [Num]: Num } -> Num
    = \list -> match list
        | []         -> 0
        | [x | xs]   -> x;

let tail: { [Num]: Num } -> { [Num]: Num }
    = \list -> match list
        | [] -> []
        | [x | xs] -> xs;


let compute: Num -> Num
    = \x -> {
        let doubled = x * 2;
        let added = doubled + 10;
        return added;
    };
let computed = compute 5; 


foreign print: String -> Unit;
foreign stringify: (a: Type) => a -> String;

let debug: Num -> Num
    = \x -> {
        print "Computing...";
        let result = x * 2;
        print (stringify result);
        return result;
    };

let run = \x:Unit -> {
    print "hello world";
};


let MyNum: Type = Num;
let MyString: Type = String;

let num: MyNum = 42;  
let str: MyString = "hi";


let Point: Type
    = { x: Num, y: Num };
let origin: Point = { x: 0, y: 0 };


let idExplicit: (a: Type) -> a -> a
    = \a -> \x -> x;
let n1 = idExplicit Num 42; 

let const: (a: Type) -> (b: Type) -> a -> b -> a
    = \a -> \b -> \x -> \y -> x;

let constNumStr = const Num String 1 "hello";

let id: (a: Type) => a -> a
    = \x -> x; 

let n2 = id 42;    
let s2 = id "hello";  

let forcedStr = id @String "hello"; 

let letpoly: Num
    = {
        let innerID = \x -> x;  
        let n: Num = innerID 42;  
        let s: String = innerID "hi";  
        return n;
    };

let Maybe: Type -> Type
    = \a -> | #nothing Unit | #just a;
let maybeNum: Maybe Num = #just 42;
let maybeStr: Maybe String = #nothing !;


let List: Type -> Type
    = \a -> | #nil Unit | #cons { a, List a };

let empty: List Num = #nil !;
let listOf1: List Num = #cons { 1, #nil ! };
let listOf3: List Num = #cons { 1, #cons { 2, #cons { 3, #nil ! } } };

let Peano: Type
    = | #zero Unit | #succ Peano;

let zero: Peano = #zero !;
let first: Peano = #succ zero;
let second: Peano = #succ first;


let Show: Type -> Type
    = \t -> { show: t -> String };
let Eq: Type -> Type
    = \t -> { eq: t -> t -> Bool };

let ShowNum: Show Num
    = { show: \n -> stringify n };
let ShowBool: Show Bool
    = { show: \b -> match b | true -> "true" | false -> "false" };

let EqNum: Eq Num
    = { eq: \x -> \y -> x == y };

let display: (t:Type) => (show: Show t) => (x: t) -> String
    = \x -> show.show x;

let areEqual: (t: Type) => (eq: Eq t) => (x: t) -> (y: t) -> Bool
    = \x -> \y -> eq.eq x y;


using ShowNum;
using EqNum;

let pretty = display 42;     
let same = areEqual 10 10; 
let diff = areEqual 5 10; 


let Functor: (Type -> Type) -> Type
    = \f -> { map: (a: Type) => (b: Type) => (a -> b) -> f a -> f b };

let mapList: (a: Type) => (b: Type) => (a -> b) -> List a -> List b
    = \f -> \list -> match list
        | #nil _           -> #nil !
        | #cons { x, xs }  -> #cons { f x, mapList f xs };

let ListFunctor: Functor List
    = { map: mapList };

let fmap: (f: Type -> Type) => (functor: Functor f) => (a: Type) => (b: Type) =>
                    (a -> b) -> f a -> f b
    = \fn -> \container -> functor.map fn container;

let strmap = fmap stringify;

let strList = strmap listOf1;




let r: Row = [x: Num, y: String]; 

let getOpenX: (r: Row) => { x: Num | r } -> Num
    = \record -> record.x;

let p1 = getOpenX { x: 10, y: 20 };
let p2 = getOpenX { x: 5, y: 3, z: 7 };
let p3 = getOpenX { x: 100, name: "point" };

let getName: (r: Row) => { name: String | r } -> String
    = \obj -> obj.name;

let person = { name: "Alice", age: 30 };
let book = { name: "1984", author: "Orwell", pages: 328 };

let name1 = getName person; 
let name2 = getName book;  

let addZ: (r: Row) => { x: Num, y: Num | r } -> { x: Num, y: Num, z: Num | r }
    = \rec -> { rec | z = 0 };


let makeType: Bool -> Type
    = \b -> match b
        | true  -> Num
        | false -> String;
let T1: Type = makeType true;
let T2: Type = makeType false;


let Vec: Num -> Type -> Type
    = \n -> \t -> match n
        | 0 -> Unit
        | l -> { t, Vec (l - 1) t };

let vec0: Vec 0 Num = !;
let vec1: Vec 1 Num = { 10, vec0 };
let vec2: Vec 2 Num = { 20, vec1 };
let vec3: Vec 3 Num = { 30, vec2 };


let DependentPair: Type
    = { fst: Type, snd: :fst };

let numPair: DependentPair
    = { fst: Num, snd: 42 };
let strPair: DependentPair
    = { fst: String, snd: "hello" };

let Pair: (a: Type) -> (p: a -> Type) -> Type
    = \a -> \p -> { fst: a, snd: p :fst };

let exampleP1: Pair Num (\n -> String)
    = { fst: 42, snd: "hello" };
let exampleP2: Pair Bool (\b -> match b | true -> Num | false -> String)
    = { fst: true, snd: 100 };


let length: (a: Type) => List a -> Num
    = \list -> match list
        | #nil _           -> 0
        | #cons { x, xs }  -> 1 + (length xs);

let Factorial: Type
    = { compute: Num -> Num };

let fact: Factorial
    = { compute: \n -> match n
        | 0 -> 1
        | _ -> n * (:compute (n - 1))
    };

let computedFac = fact.compute 5; 




let Nat: Type
    = Num [|\n -> n >= 0 |];

let Pos: Type
    = Num [|\p -> p > 0 |];

let n: Nat = 42; 
let p: Pos = 42; 
let zero: Nat = 0; 


let exactOne: Num [|\v -> v == 1 |] = 1; 

let inc: (x: Num) -> Num [|\v -> v == (x + 1) |]
    = \x -> x + 1;


let hof: (f: Nat -> Nat) -> Nat
    = \f -> f 1;

let hof2: (Num -> Nat) -> Pos
    = \f -> (f 1) + 1;

let takePosFunction: (Pos -> Num) -> Num
    = \f -> f 10;

let natToNum: Nat -> Num = \x -> x;
let posToNum: Pos -> Num = \x -> x;

let result1 = takePosFunction natToNum;
let result2 = takePosFunction posToNum;

let checkNum: (p: Num -> Bool) -> Num[| \v -> p v |] -> Num
    = \p -> \x -> x;

let nat5 = checkNum (\n -> n >= 0) 5; 

let safeInc: (p: Num -> Bool) -> (x: Num[|\v -> p (v + 1) |]) -> Num[|\v -> p v |]
    = \p -> \x -> x + 1;
let natInc = safeInc (\n -> n >= 0); 
let posInc = safeInc (\n -> n > 0); 

let OrderedPair: Type
    = { fst: Num, snd: Num[|\v -> v > :fst |] };

let valid: OrderedPair = { fst: 3, snd: 5 }; 
let invalid: OrderedPair = { fst: 5, snd: 3 }; 

let OrderedList: (t: Type) -> (p: t -> t -> Bool) -> Type
    = \t -> \p -> 
        | #nil Unit
        | #cons { head: t, tail: OrderedList (t[| \v -> p :head v |]) p };


let ascending: OrderedList Num (\x -> \y -> x < y)
    = #cons { head: 1, tail: #cons { head: 2, tail: #cons { head: 3, tail: #nil ! } } };

let descending: OrderedList Num (\x -> \y -> x > y)
    = #cons { head: 3, tail: #cons { head: 2, tail: #cons { head: 1, tail: #nil ! } } };

