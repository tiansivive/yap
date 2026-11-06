## abs (let)
λ(n: Num) ->
  (closure: match FFI.$lte 0 n | true -> n | false -> FFI.$sub 0 n -| Γ: n)

## absNegatesBoth (let)
λ(n: Num) ->
  (closure: match FFI.$lte 0 n
    | true -> FFI.$sub 0 n
    | false -> FFI.$sub 0 n -| Γ: n)

## absKeepsBoth (let)
λ(n: Num) -> (closure: match FFI.$lte 0 n | true -> n | false -> n -| Γ: n)
