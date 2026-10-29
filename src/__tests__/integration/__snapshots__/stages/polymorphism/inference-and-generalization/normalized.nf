## inc (let)
λ(x: Num) -> (closure: FFI.$add x 1 -| Γ: x)

## fst (let)
λ(a: Type) =>
  (closure: λ(b: Type) =>
    (λ(x: a) -> (λ(y: b) -> x : Π(y: b) -> a) : Π(x: a) ->
      Π(y: b) -> a) -| Γ: a)
