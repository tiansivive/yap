export *;


let num: Num = 1;
let str: String = "hello world";
let bool: Bool = true;


let fn
  : Num -> String
  = \x -> "woop woop";

let app = fn 1;


let fn2 = \x:Int -> "hallo";
let fullyInferred = \x -> x + 1;



let record
  : { foo: Num, bar: String }
  = { foo: 1, bar: "hello" };

let fieldAccess: Num = record.foo;
let fieldUpdate = { record | foo = 10 };



let polymorphicId = \x -> x;

let one: Num = polymorphicId 1;
let two: String = polymorphicId "two";


let explicit
  : (a: Type) => (x: a) -> a
  = \a => \x -> x;


let omitImplicitParam
  : (a: Type) => (x: a) -> a
  = \x -> x;

let explicitApp
  : String -> String 
  = explicit @String



