## print (foreign)


## stringify (foreign)


## greet (let)
λ(name: String) ->
  (closure: { FFI.print (FFI.$concat "Hello, " name); return unit; } -| Γ: name)
