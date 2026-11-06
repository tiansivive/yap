## fn (let)
λ(x: Num) -> (closure: 2 -| Γ: x)

## posTestCheckLambdaPostCondition (let)
λ(x: Num) -> (closure: 1 -| Γ: x)

## posTestCheckLambdaPreCondition (let)
λ(x: <ω> Num [| λ(st: State) ->
  (closure: λ(n: Num) -> FFI.$gt n 0 -| Γ: st) |]) ->
  (closure: x -| Γ: x)

## posTestCheckLambdaPreAndPostCondition (let)
λ(x: <ω> Num [| λ(st: State) ->
  (closure: λ(n: Num) -> FFI.$gt n 0 -| Γ: st) |]) ->
  (closure: x -| Γ: x)

## posTestCheckRefinedResultLambda (let)
λ(x: Num) -> (closure: FFI.$add x 1 -| Γ: x)

## inc (let)
λ(x: Num) -> (closure: FFI.$add x 1 -| Γ: x)
