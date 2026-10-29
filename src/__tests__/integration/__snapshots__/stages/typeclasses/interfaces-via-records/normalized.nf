## stringify (foreign)


## Show (let)
λ(t: Type) ->
  (closure: Σ($sig: [ show: Irrelevant ]) .
    Schema [ show: Π(t3: t) -> String ] -| Γ: t)

## Eq (let)
λ(t: Type) ->
  (closure: Σ($sig: [ eq: Irrelevant ]) .
    Schema [ eq: Π(t5: t) -> Π(t6: t) -> Bool ] -| Γ: t)

## ShowNum (let)
Struct [ show: λ(n: Num) -> (closure: FFI.stringify @Num n -| Γ: n) ]

## ShowBool (let)
Struct
  [ show: λ(b: Bool) ->
      (closure: match b | true -> "true" | false -> "false" -| Γ: b) ]

## EqNum (let)
Struct [ eq: λ(x: Num) -> (closure: λ(y: Num) -> FFI.$eq x y -| Γ: x) ]
