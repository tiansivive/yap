## getName (let)
λ(r: Row) =>
  (closure: λ(obj: Σ($sig: [ name: Irrelevant ]) .
    Schema [ name: String | r ]) ->
    (obj).name -| Γ: r)

## person (let)
Struct [ name: "Alice", age: 30 ]

## book (let)
Struct [ name: "1984", author: "Orwell", pages: 328 ]

## n1 (let)
"Alice"

## n2 (let)
"1984"
