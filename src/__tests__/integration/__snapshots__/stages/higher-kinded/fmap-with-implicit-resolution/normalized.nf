## stringify (foreign)


## List (let)
List

## Functor (let)
λ(f: Π(t4: Type) -> (closure: Type -| Γ: t4)) ->
  (closure: Σ($sig: [ map: Irrelevant ]) .
    Schema
      [ map: Π(a: Type) =>
          Π(b: Type) => Π(t5: Π(t6: a) -> b) -> Π(t7: f a) -> f b ] -| Γ: f)

## mapList (let)
λ(a: Type) =>
  (closure: λ(b: Type) =>
    λ(f: Π(t9: a) -> b) ->
      λ(list: List a) ->
        match list
          | Variant [ nil: _ | $row_7 ] -> Struct [ __tag: nil, payload: unit ]
          | Variant [ cons: Struct [ 0: x, 1: xs | $row_13 ] | $row_14 ] ->
              Struct
                [ __tag: cons,
                  payload: νstrict [] .
                    Struct [ 0: f x, 1: I8 @a @b f xs ] ] -| Γ: a)

## ListFunctor (let)
Struct [ map: λ(a: Type) => (closure: λ(b: Type) => mapList @a @b -| Γ: a) ]

## fmap (let)
λ(f: Π(t11: Type) -> (closure: Type -| Γ: t11)) =>
  (closure: λ(functor: Functor f) =>
    λ(a: Type) =>
      λ(b: Type) =>
        λ(fn: Π(t13: a) -> b) ->
          λ(container: f a) -> ((functor).map) @a @b fn container -| Γ: f)

## (using) (using)


## strmap (let)
λ(F: Π(t11: Type) -> (closure: Type -| Γ: t11)) =>
  (closure: λ(a: Type) =>
    λ(A: Functor F) => fmap @F @A @a @String (FFI.stringify @a) -| Γ: F)

## listOf1 (let)
Struct
  [ __tag: cons,
    payload: Struct [ 0: 1, 1: Struct [ __tag: nil, payload: unit ] ] ]

## strList (let)
Struct
  [ __tag: cons,
    payload: Struct
      [ 0: (stringify: (Num) (1)), 1: Struct [ __tag: nil, payload: unit ] ] ]
