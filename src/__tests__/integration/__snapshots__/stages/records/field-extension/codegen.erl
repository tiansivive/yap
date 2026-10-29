## point (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 10
in let <V1> = call 'maps':'from_list'([{'x', V0}])
in V1
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## point3d (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 30
in let <V1> = 20
in let <V2> = Point
in let <V3> = call 'maps':'merge'(V2, call 'maps':'from_list'([{'y', V1}]))
in let <V4> = call 'maps':'merge'(V3, call 'maps':'from_list'([{'z', V0}]))
in V4
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## updated (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 100
in let <V1> = Point
in let <V2> = call 'maps':'merge'(V1, call 'maps':'from_list'([{'x', V0}]))
in V2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## updatedX (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = Updated
in let <V1> = call 'maps':'get'('x', V0)
in V1
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

