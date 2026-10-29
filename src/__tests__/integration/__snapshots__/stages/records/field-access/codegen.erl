## point (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 10
in let <V1> = 20
in let <V2> = call 'maps':'from_list'([{'x', V0}, {'y', V1}])
in V2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## xCoord (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = Point
in let <V1> = call 'maps':'get'('x', V0)
in V1
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## getX (let)
module 'yap_main' ['main'/0, 'closure_20'/2]
attributes []

'closure_20'/2 = fun (Env0, P1) ->
  let <V0> = call 'maps':'get'('x', P1)
  in V0

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_20'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

