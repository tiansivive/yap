## Point (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = call 'maps':'from_list'([])
in V0
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## origin (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 0
in let <V1> = 0
in let <V2> = call 'maps':'from_list'([{'x', V0}, {'y', V1}])
in V2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

