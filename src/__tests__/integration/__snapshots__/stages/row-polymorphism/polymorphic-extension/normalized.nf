## addZ (let)
λ(r: Row) =>
  (closure: λ(rec: Σ($sig: [ x: Irrelevant, y: Irrelevant ]) .
    Schema [ x: Num, y: Num | r ]) ->
    { rec | z = 0 } -| Γ: r)

## p1 (let)
Struct [ x: 1, y: 2, z: 0 ]

## p2 (let)
Struct [ x: 5, y: 10, color: "red", z: 0 ]
