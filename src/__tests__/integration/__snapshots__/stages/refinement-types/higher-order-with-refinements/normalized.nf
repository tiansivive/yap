## Nat (let)
<ω> Num [| λ(n: Num) -> (closure: FFI.$gte n 0 -| Γ: n) |]

## Pos (let)
<ω> Num [| λ(p: Num) -> (closure: FFI.$gt p 0 -| Γ: p) |]

## hof (let)
λ(f: Π(t1: <ω> Num [| λ(n: Num) -> (closure: FFI.$gte n 0 -| Γ: n) |]) ->
  (closure: <ω> Num [| λ(n: Num) -> FFI.$gte n 0 |] -| Γ: t1)) ->
  (closure: f 1 -| Γ: f)

## hof2 (let)
λ(f: Π(t3: Num) ->
  (closure: <ω> Num [| λ(n: Num) -> FFI.$gte n 0 |] -| Γ: t3)) ->
  (closure: FFI.$add (f 1) 1 -| Γ: f)
