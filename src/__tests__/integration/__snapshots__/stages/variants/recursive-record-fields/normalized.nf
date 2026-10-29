## Factorial (let)
Σ($sig: [ compute: Irrelevant ]) .
  (closure: Schema [ compute: Π(t1: Num) -> Num ] -| Γ: $sig)

## fact (let)
Struct
  [ compute: λ(n: Num) ->
      (closure: match n
        | 0 -> 1
        | _ -> FFI.$mul n ($compute (FFI.$sub n 1)) -| Γ: n) ]

## result (let)
120
