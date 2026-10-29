## Shape (let)
Variant
  [ point: Σ($sig: [ x: Irrelevant, y: Irrelevant ]) .
      (closure: Schema [ x: Num, y: Num ] -| Γ: $sig),
    rectangle: Schema [ 1: Num, 0: Num ],
    circle: Num ]

## describeShape (let)
λ(s: Variant
  [ point: Σ($sig: [ x: Irrelevant, y: Irrelevant ]) .
      (closure: Schema [ x: Num, y: Num ] -| Γ: $sig),
    rectangle: Schema [ 1: Num, 0: Num ],
    circle: Num ]) ->
  (closure: match s
    | Variant [ circle: r | $row_8 ] -> "Circle with radius"
    | Variant [ rectangle: Struct [ 0: w, 1: h | $row_13 ] | $row_14 ] ->
        "Rectangle"
    | Variant [ point: Struct [ x: _, y: _ | $row_19 ] | $row_20 ] ->
        "Point at coordinates" -| Γ: s)
