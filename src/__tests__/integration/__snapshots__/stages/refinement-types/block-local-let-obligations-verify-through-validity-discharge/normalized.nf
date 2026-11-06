## compute (let)
λ(x: Num) ->
  (closure: {
    let doubled
      : <ω> Num [| λ(st: State) ->
        (closure: λ(r: Num) -> FFI.$eq r (FFI.$mul x y) -| Γ: st; y; x) |]
      = FFI.$mul x 2;
    let added
      : <ω> Num [| λ(st: State) ->
        (closure: λ(r: Num) -> FFI.$eq r (FFI.$add x y) -| Γ: st; y; x) |]
      = FFI.$add doubled 10;
    return added;
  } -| Γ: x)
