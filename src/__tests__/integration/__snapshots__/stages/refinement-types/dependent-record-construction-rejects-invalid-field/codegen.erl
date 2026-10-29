## testFail (let)
module 'yap_main' ['main'/0, 'closure_40'/2, 'closure_39'/2, 'closure_38'/2]
attributes []

'closure_40'/2 = fun (Env0, P1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Cap_1> = call 'maps':'get'('v1', Env0)
  in let <V0> = call 'maps':'from_list'([])
  in V0

'closure_39'/2 = fun (Env0, B1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', Cap_0}, {'v1', B1}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_40'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_38'/2 = fun (Env0, A1) ->
  let <Env_cls2> = call 'maps':'from_list'([{'v0', A1}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_39'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_38'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in let <Pair3> = Closure_cls2
in let <V4> = 2
in let <V5> = 1
in let <V6> = call 'maps':'from_list'([{'fst', V4}, {'snd', V5}])
in let <P7> = V6
in let <V8> = 1
in V8
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

