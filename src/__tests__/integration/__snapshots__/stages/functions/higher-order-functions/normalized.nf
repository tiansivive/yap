## compose (let)
λ(f: Π(t2: Num) -> (closure: Num -| Γ: t2)) ->
  (closure: λ(g: Π(t4: Num) -> Num) -> λ(x: Num) -> f (g x) -| Γ: f)

## add1 (let)
λ(x: Num) -> (closure: FFI.$add x 1 -| Γ: x)

## add5 (let)
λ(x: Num) -> (closure: FFI.$add x 5 -| Γ: x)

## double (let)
λ(x: Num) -> (closure: FFI.$mul x 2 -| Γ: x)

## add1ThenDouble (let)
λ(x: Num) -> (closure: f (g x) -| Γ: x; g; f; compose)
