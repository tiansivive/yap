## firstOrZero (let)
λ(list: FFI.Indexed Num Num @FFI.defaultArray) ->
  (closure: match list | [  ] -> 0 | [ x,  | xs ] -> x -| Γ: list)

## tail (let)
λ(list: FFI.Indexed Num Num @FFI.defaultArray) ->
  (closure: match list | [  ] -> Array [] | [ x,  | xs ] -> xs -| Γ: list)
