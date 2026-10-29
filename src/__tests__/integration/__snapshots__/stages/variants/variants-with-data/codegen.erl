## Shape (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = call 'maps':'from_list'([])
in let <V1> = Num
in let <V2> = call 'maps':'from_list'([{'1', V1}, {'0', V1}])
in let <V3> = call 'maps':'from_list'([{'point', V0}, {'rectangle', V2}, {'circle', V1}])
in V3
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## c (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 'circle'
in let <V1> = 5
in let <V2> = call 'maps':'from_list'([{'__tag', V0}, {'payload', V1}])
in V2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## r (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 'rectangle'
in let <V1> = 10
in let <V2> = 20
in let <V3> = call 'maps':'from_list'([{'0', V1}, {'1', V2}])
in let <V4> = call 'maps':'from_list'([{'__tag', V0}, {'payload', V3}])
in V4
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## p (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 'point'
in let <V1> = 0
in let <V2> = 0
in let <V3> = call 'maps':'from_list'([{'x', V1}, {'y', V2}])
in let <V4> = call 'maps':'from_list'([{'__tag', V0}, {'payload', V3}])
in V4
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

