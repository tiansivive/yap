## Nat (let)
<ω> Num [| λ(st: State) -> (closure: λ(n: Num) -> FFI.$gte n 0 -| Γ: st) |]

## Pos (let)
<ω> Num [| λ(st: State) -> (closure: λ(p: Num) -> FFI.$gt p 0 -| Γ: st) |]

## hof (let)
λ(f: Π(t1: <ω> Num [| λ(st: State) ->
  (closure: λ(n: Num) -> FFI.$gte n 0 -| Γ: st; Nat) |]) ->
  (closure: Nat -| Γ: t1)) ->
  (closure: f 1 -| Γ: f)

## hof2 (let)
λ(f: Π(t3: Num) -> (closure: Nat -| Γ: t3)) ->
  (closure: FFI.$add (f 1) 1 -| Γ: f)
