## (expr) (expression)
λ(r: Row) =>
  (closure: λ(a: Type) =>
    λ(A: a) =>
      (λ(x: Variant [ some: A | r ]) ->
        match x | Variant [ some: v | $row_4 ] -> v : Π(x: Variant
        [ some: A | r ]) ->
        A) -| Γ: r)
