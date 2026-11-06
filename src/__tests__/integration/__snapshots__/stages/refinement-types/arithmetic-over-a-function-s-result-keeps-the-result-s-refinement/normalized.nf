## Nat (let)
<ω> Num [| λ(st: State) -> (closure: λ(n: Num) -> FFI.$gte n 0 -| Γ: st) |]

## Pos (let)
<ω> Num [| λ(st: State) -> (closure: λ(p: Num) -> FFI.$gt p 0 -| Γ: st) |]

## addOne (let)
λ(f: Π(t2: Num) -> (closure: Nat -| Γ: t2)) ->
  (closure: FFI.$add (f 1) 1 -| Γ: f)

## addZero (let)
λ(f: Π(t4: Num) -> (closure: Nat -| Γ: t4)) ->
  (closure: FFI.$add (f 1) 0 -| Γ: f)
