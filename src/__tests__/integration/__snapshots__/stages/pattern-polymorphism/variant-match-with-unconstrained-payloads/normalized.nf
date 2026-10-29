## (expr) (expression)
λ(a: Type) =>
  (closure: λ(A: a) =>
    λ(r: Row) =>
      λ(s: Row) =>
        λ(b: Type) =>
          λ(B: b) =>
            λ(c: Type) =>
              λ(C: c) =>
                (λ(x: Variant
                  [ nil: A | [ cons: Schema [ 0: B, 1: C | s ] | r ] ]) ->
                  match x
                    | Variant [ nil: a | $row_4 ] -> 0
                    | Variant [ cons: Struct [ 0: el,
                        1: rest | $row_9 ] | $row_10 ] ->
                        1 : Π(x: Variant
                  [ nil: A | [ cons: Schema [ 0: B, 1: C | s ] | r ] ]) ->
                  Num) -| Γ: a)
