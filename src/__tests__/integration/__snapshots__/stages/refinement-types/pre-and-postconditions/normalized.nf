## Nat (let)
<ω> Num [| λ(st: State) -> (closure: λ(n: Num) -> FFI.$gte n 0 -| Γ: st) |]

## safe (let)
λ(x: <ω> Num [| λ(st: State) ->
  (closure: λ(n: Num) -> FFI.$gte n 0 -| Γ: st; Nat) |]) ->
  (closure: x -| Γ: x)
