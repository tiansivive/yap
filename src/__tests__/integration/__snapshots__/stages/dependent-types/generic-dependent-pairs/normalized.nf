## Pair (let)
λ(a: Type) ->
  (closure: λ(p: Π(t1: a) -> Type) ->
    Σ($sig: [ fst: Irrelevant, snd: Irrelevant ]) .
      Schema [ fst: a, snd: p &fst ] -| Γ: a)

## exampleP1 (let)
Struct [ fst: 42, snd: "hello" ]

## exampleP2 (let)
Struct [ fst: true, snd: 100 ]
