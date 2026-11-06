## Nat (let)
<ω> Num [| λ(st: State) -> (closure: λ(n: Num) -> FFI.$gte n 0 -| Γ: st) |]

## Pos (let)
<ω> Num [| λ(st: State) -> (closure: λ(p: Num) -> FFI.$gt p 0 -| Γ: st) |]

## useNat (let)
λ(n: <ω> Num [| λ(st: State) ->
  (closure: λ(n: Num) -> FFI.$gte n 0 -| Γ: st; Nat) |]) ->
  (closure: n -| Γ: n)

## p (let)
42

## result (let)
42
