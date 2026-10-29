## fn (let)
λ(x: Num) -> (closure: 2 -| Γ: x)

## posTestCheckLambdaPostCondition (let)
λ(x: Num) -> (closure: 1 -| Γ: x)

## posTestCheckLambdaPreCondition (let)
λ(x: <ω> Num [| λ(n: Num) -> (closure: FFI.$gt n 0 -| Γ: n) |]) ->
  (closure: x -| Γ: x)

## posTestCheckLambdaPreAndPostCondition (let)
λ(x: <ω> Num [| λ(n: Num) -> (closure: FFI.$gt n 0 -| Γ: n) |]) ->
  (closure: x -| Γ: x)

## posTestCheckRefinedResultLambda (let)
λ(x: Num) -> (closure: FFI.$add x 1 -| Γ: x)

## inc (let)
λ(x: Num) -> (closure: FFI.$add x 1 -| Γ: x)
