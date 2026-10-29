## compute (let)
module 'yap_main' ['main'/0, 'closure_24'/2]
attributes []

'closure_24'/2 = fun (Env0, X1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Cap_1> = call 'maps':'get'('v1', Env0)
  in let <V0> = 2
  in let <V1> = call 'erlang':'*'(X1, V0)
  in let <Doubled2> = V1
  in let <V3> = 10
  in let <V4> = call 'erlang':'+'(Doubled2, V3)
  in let <Added5> = V4
  in Added5

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([{'v0', Doubled}, {'v1', Added}])
in let <Fnref_cls2> = fun 'yap_main':'closure_24'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## result (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = Compute
in let <V1> = 5
in let <Fnref2> = call 'maps':'get'('__fn', V0)
in let <Env3> = call 'maps':'get'('__env', V0)
in let <V4> = apply Fnref2(Env3, V1)
in V4
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

