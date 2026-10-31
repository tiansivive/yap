## List (let)
List

## Functor (let)
λ(f: Π(t3: Type) -> (closure: Type -| Γ: t3)) ->
  (closure: Σ($sig: [ map: Irrelevant ]) .
    Schema
      [ map: Π(a: Type) =>
          Π(b: Type) => Π(t4: Π(t5: a) -> b) -> Π(t6: f a) -> f b ] -| Γ: f)

## mapList (let)
λ(a: Type) =>
  (closure: λ(b: Type) =>
    λ(f: Π(t8: a) -> b) ->
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
