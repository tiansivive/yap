## id (let)
λ(a: Type) -> (closure: λ(x: a) -> x -| Γ: a)

## const (let)
λ(a: Type) -> (closure: λ(b: Type) -> λ(x: a) -> λ(y: b) -> x -| Γ: a)
