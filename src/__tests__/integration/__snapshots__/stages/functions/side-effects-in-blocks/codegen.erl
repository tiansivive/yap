## print (foreign)


## stringify (foreign)


## debug (let)
module 'yap_main' ['main'/0, 'closure_34'/2]
attributes []

'closure_34'/2 = fun (Env0, X1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <V0> = "Computing..."
  in let <V1> = apply Print(V0)
  in let <V2> = 2
  in let <V3> = call 'erlang':'*'(X1, V2)
  in let <Result4> = V3
  in let <V6> = apply Stringify(V5, Result4)
  in let <V7> = apply Print(V6)
  in Result4

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([{'v0', Result}])
in let <Fnref_cls2> = fun 'yap_main':'closure_34'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

