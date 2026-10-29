## block (let)
module 'yap_main' ['main'/0, 'closure_19'/2]
attributes []

'closure_19'/2 = fun (Env0, O1) ->
  let <V0> = 1
  in let <V1> = call 'erlang':'+'(O1, V0)
  in V1

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_19'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in let <F3> = Closure_cls2
in let <V4> = 1
in let <Fnref5> = call 'maps':'get'('__fn', F3)
in let <Env6> = call 'maps':'get'('__env', F3)
in let <V7> = apply Fnref5(Env6, V4)
in V7
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

