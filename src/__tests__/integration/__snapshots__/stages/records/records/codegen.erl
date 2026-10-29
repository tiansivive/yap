## point (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 0
in let <V1> = 10
in let <V2> = call 'maps':'from_list'([{'x', V0}, {'y', V1}])
in V2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## person (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = "Alice"
in let <V1> = 30
in let <V2> = call 'maps':'from_list'([{'name', V0}, {'age', V1}])
in V2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

