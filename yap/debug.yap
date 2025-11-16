export *;



let PairD
    : (a: Type) -> (p: a -> Type) -> Type
    = \a -> \p -> { fst: a, snd: p :fst };

let p
    : PairD Num (\n -> String)
    = { fst: 1, snd: "hello" };

let PairR
    : (a: Type) -> (b: Type) -> (p: a -> b -> Bool ) -> Type
    = \a -> \b -> \p -> { fst: a, snd: b[| \v -> p :fst v |] };

let pair
    : PairR Num Num (\x -> \y -> x < y )
    = { fst: 3, snd: 5 };