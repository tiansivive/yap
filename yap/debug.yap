export *;

foreign print: String -> Unit;
foreign stringify: (a: Type) => a -> String;

let run = \x:Unit -> {
    print "hello world";
};


let List: Type -> Type
    = \a -> | #nil Unit | #cons { a, List a };

let Functor: (Type -> Type) -> Type
    = \f -> { map: (a: Type) => (b: Type) => (a -> b) -> f a -> f b };

let mapList: (a: Type) => (b: Type) => (a -> b) -> List a -> List b
    = \f -> \list -> match list
        | #nil _           -> #nil !
        | #cons { x, xs }  -> #cons { f x, mapList f xs };

let ListFunctor: Functor List
    = { map: mapList };

let polymorphicMap: (f: Type -> Type) => (functor: Functor f) => (a: Type) => (b: Type) =>
                    (a -> b) -> f a -> f b
    = \fn -> \container -> functor.map fn container;

let one: List Num = #cons { 1, #nil ! };