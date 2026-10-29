## Shape (let)
Variant
  [ point: Σ($sig: [ x: Irrelevant, y: Irrelevant ]) .
      (closure: Schema [ x: Num, y: Num ] -| Γ: $sig),
    rectangle: Schema [ 1: Num, 0: Num ],
    circle: Num ]

## c (let)
Struct [ __tag: circle, payload: 5 ]

## r (let)
Struct [ __tag: rectangle, payload: Struct [ 0: 10, 1: 20 ] ]

## p (let)
Struct [ __tag: point, payload: Struct [ x: 0, y: 0 ] ]
