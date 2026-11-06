## abs (let)
λ(x: Num) ->
  (closure: match FFI.$lte 0 x | true -> x | false -> FFI.$sub 0 x -| Γ: x)

## absNegatesBoth (let)
λ(x: Num) ->
  (closure: match FFI.$lte 0 x
    | true -> FFI.$sub 0 x
    | false -> FFI.$sub 0 x -| Γ: x)

## absKeepsBoth (let)
λ(x: Num) -> (closure: match FFI.$lte 0 x | true -> x | false -> x -| Γ: x)
