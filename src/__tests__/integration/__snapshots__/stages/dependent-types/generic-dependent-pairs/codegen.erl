## Pair (let)
module 'yap_main' ['main'/0, 'closure_27'/2, 'closure_26'/2]
attributes []

'closure_27'/2 = fun (Env0, P1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <V0> = call 'maps':'from_list'([])
  in V0

'closure_26'/2 = fun (Env0, A1) ->
  let <Env_cls2> = call 'maps':'from_list'([{'v0', A1}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_27'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_26'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## exampleP1 (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 42
in let <V1> = "hello"
in let <V2> = call 'maps':'from_list'([{'fst', V0}, {'snd', V1}])
in V2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## exampleP2 (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 'true'
in let <V1> = 100
in let <V2> = call 'maps':'from_list'([{'fst', V0}, {'snd', V1}])
in V2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

