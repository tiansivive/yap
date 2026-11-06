## Nat (let)
<ω> Num [| λ(st: State) -> (closure: λ(n: Num) -> FFI.$gte n 0 -| Γ: st) |]

## Pos (let)
<ω> Num [| λ(st: State) -> (closure: λ(p: Num) -> FFI.$gt p 0 -| Γ: st) |]

## takePosFunction (let)
λ(f: Π(t2: <ω> Num [| λ(st: State) ->
  (closure: λ(p: Num) -> FFI.$gt p 0 -| Γ: st; Pos) |]) ->
  (closure: Num -| Γ: t2)) ->
  (closure: f 10 -| Γ: f)

## natToNum (let)
λ(x: <ω> Num [| λ(st: State) ->
  (closure: λ(n: Num) -> FFI.$gte n 0 -| Γ: st; Nat) |]) ->
  (closure: x -| Γ: x)

## posToNum (let)
λ(x: <ω> Num [| λ(st: State) ->
  (closure: λ(p: Num) -> FFI.$gt p 0 -| Γ: st; Pos) |]) ->
  (closure: x -| Γ: x)

## result1 (let)
10

## result2 (let)
10
