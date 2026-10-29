## TrafficLight (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 'Unit'
in let <V1> = 'Unit'
in let <V2> = 'Unit'
in let <V3> = call 'maps':'from_list'([{'green', V0}, {'yellow', V1}, {'red', V2}])
in V3
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## light (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 'red'
in let <V1> = 'nil'
in let <V2> = call 'maps':'from_list'([{'__tag', V0}, {'payload', V1}])
in V2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

