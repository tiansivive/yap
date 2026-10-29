## Peano (let)
Peano

## zero (let)
Struct [ __tag: zero, payload: unit ]

## first (let)
Struct [ __tag: succ, payload: Struct [ __tag: zero, payload: unit ] ]

## second (let)
Struct
  [ __tag: succ,
    payload: Struct
      [ __tag: succ, payload: Struct [ __tag: zero, payload: unit ] ] ]
