1. Use typed metas

- Fixes generalization
- Allows the use of a `Any` or `Empty Row` type for unsolved metas

###Solutions

```ml
let f = \x -> match x | #foo 0 -> 0 | #foo y -> 1 | #bar z -> z;
 :: Π(<ω> a: Type) => Π(<ω> x: Variant [ foo: Num, bar: Num | I0 ]) -> Num

> f #foo 1
```

When elaborated, results in unsolved meta:

```haskell
f @?11 (Struct [ foo: 1 ])
```

with constraints

```haskell
?11 @Type -- Incorrect! Should be @Row
Variant [ foo: Num | ?12 ] ~~ Variant [ foo: Num, bar: Num | ?11 ]
```

After solving, `?11` will remain unsolved, which currently gets wrapped in a lambda (generalised).
Instead, we should instantiate `?11` to `Any :: Type` or `[] :: Row`
