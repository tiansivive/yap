## Nat (let)
<ω> Num [| λ(n: Num) -> (closure: FFI.$gte n 0 -| Γ: n) |]

## safe (let)
λ(x: <ω> Num [| λ(n: Num) -> (closure: FFI.$gte n 0 -| Γ: n; Nat) |]) ->
  (closure: x -| Γ: x)
