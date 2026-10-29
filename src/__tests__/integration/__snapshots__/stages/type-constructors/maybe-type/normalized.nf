## Maybe (let)
λ(a: Type) -> (closure: Variant [ just: a, nothing: Unit ] -| Γ: a)

## maybeNum (let)
Struct [ __tag: just, payload: 42 ]

## maybeStr (let)
Struct [ __tag: nothing, payload: unit ]
