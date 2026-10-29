## Nat (let)
<ω> Num [| λ(n: Num) -> (closure: FFI.$gte n 0 -| Γ: n) |]

## Pos (let)
<ω> Num [| λ(p: Num) -> (closure: FFI.$gt p 0 -| Γ: p) |]

## useNat (let)
λ(n: <ω> Num [| λ(n: Num) -> (closure: FFI.$gte n 0 -| Γ: n) |]) ->
  (closure: n -| Γ: n)

## p (let)
42

## result (let)
42
