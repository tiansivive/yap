export *;

let Pair
    : (a: Type) -> (b: Type) -> (p: a -> b -> Bool ) -> Type
    = \a -> b -> p -> { fst: a, snd: b[|\v -> p :fst v |] };


let List
    : Type -> Type
    = \t -> | #nil Unit | #cons { t, List t };


let test = {
	let const = \x -> \y -> x;
	let numResult = const 5 42;
	let strResult = const "kept" 100;
};

let test2 = {
    let id = \y -> y;
    let numResult = id 5;
    let strResult = id "world";
};