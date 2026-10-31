## stringify (foreign)


## Functor (let)
λ(f: Π(t3: Type) -> (closure: Type -| Γ: t3)) ->
  (closure: Σ($sig: [ map: Irrelevant ]) .
    Schema
      [ map: Π(a: Type) =>
          Π(b: Type) => Π(t4: Π(t5: a) -> b) -> Π(t6: f a) -> f b ] -| Γ: f)

## fmap (let)
λ(f: Π(t7: Type) -> (closure: Type -| Γ: t7)) =>
  (closure: λ(functor: Functor f) =>
    λ(a: Type) =>
      λ(b: Type) =>
        λ(fn: Π(t9: a) -> b) ->
          λ(container: f a) -> ((functor).map) @a @b fn container -| Γ: f)

## Option (let)
λ(a: Type) -> (closure: Variant [ none: Unit, some: a ] -| Γ: a)

## mapOption (let)
λ(a: Type) =>
  (closure: λ(b: Type) =>
    λ(f: Π(t13: a) -> b) ->
      λ(o: Option a) ->
        match o
          | Variant [ some: x | $row_7 ] -> Struct [ __tag: some, payload: f x ]
          | Variant [ none: _ | $row_11 ] ->
              Struct [ __tag: none, payload: unit ] -| Γ: a)

## OptionFunctor (let)
Struct [ map: λ(a: Type) => (closure: λ(b: Type) => mapOption @a @b -| Γ: a) ]

## (using) (using)


## x (let)
Struct [ __tag: some, payload: 1 ]

## y (let)
Struct [ __tag: some, payload: (stringify: (Num) (1)) ]
