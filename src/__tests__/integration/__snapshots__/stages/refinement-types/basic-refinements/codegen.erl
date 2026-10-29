## Nat (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = V0
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## Pos (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = V0
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## n (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 42
in V0
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## p (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 42
in V0
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## zero (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 0
in V0
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

