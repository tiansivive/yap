## print (foreign)


## stringify (foreign)


## debug (let)
λ(x: Num) ->
  (closure: {
    FFI.print "Computing...";
    let result
      : <ω> Num [| λ(st: State) ->
        (closure: λ(r: Num) -> FFI.$eq r (FFI.$mul x y) -| Γ: st; y; x) |]
      = FFI.$mul x 2;
    FFI.print
      (FFI.stringify
        @<ω> Num [| λ(st: State) -> λ(r: Num) -> FFI.$eq r (FFI.$mul x 2) |]
        result);
    return result;
  } -| Γ: x)
