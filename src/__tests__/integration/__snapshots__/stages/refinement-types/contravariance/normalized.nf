## Nat (let)
<ω> Num [| λ(n: Num) -> (closure: FFI.$gte n 0 -| Γ: n) |]

## Pos (let)
<ω> Num [| λ(p: Num) -> (closure: FFI.$gt p 0 -| Γ: p) |]

## takePosFunction (let)
λ(f: Π(t2: <ω> Num [| λ(p: Num) -> (closure: FFI.$gt p 0 -| Γ: p) |]) ->
  (closure: Num -| Γ: t2)) ->
  (closure: f 10 -| Γ: f)

## natToNum (let)
λ(x: <ω> Num [| λ(n: Num) -> (closure: FFI.$gte n 0 -| Γ: n) |]) ->
  (closure: x -| Γ: x)

## posToNum (let)
λ(x: <ω> Num [| λ(p: Num) -> (closure: FFI.$gt p 0 -| Γ: p) |]) ->
  (closure: x -| Γ: x)

## result1 (let)
10

## result2 (let)
10
