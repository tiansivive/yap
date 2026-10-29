## (expr) (expression)
λ(r: Row) =>
  (closure: λ(a: Type) =>
    λ(A: a) =>
      λ(b: Type) =>
        λ(B: b) =>
          (λ(x: Schema [ foo: A, bar: B | r ]) ->
            match x | Struct [ foo: y, bar: z | $row_6 ] -> 0 : Π(x: Schema
            [ foo: A, bar: B | r ]) ->
            Num) -| Γ: r)
