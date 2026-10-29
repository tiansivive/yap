## getY (let)
λ(p: Σ($sig: [ x: Irrelevant, y: Irrelevant ]) .
  (closure: Schema [ x: Num, y: Num ] -| Γ: $sig)) ->
  (closure: match p | Struct [ x: a, y: b | $row_5 ] -> b -| Γ: p)

## getY2 (let)
λ(p: Σ($sig: [ x: Irrelevant, y: Irrelevant ]) .
  (closure: Schema [ x: Num, y: Num ] -| Γ: $sig)) ->
  (closure: match p | Struct [ y: a | $row_8 ] -> a -| Γ: p)
