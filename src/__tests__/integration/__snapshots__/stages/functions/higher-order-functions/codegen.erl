## compose (let)
module 'yap_main' ['main'/0, 'closure_23'/2, 'closure_22'/2, 'closure_21'/2]
attributes []

'closure_23'/2 = fun (Env0, X1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Cap_1> = call 'maps':'get'('v1', Env0)
  in let <Fnref0> = call 'maps':'get'('__fn', Cap_1)
  in let <Env1> = call 'maps':'get'('__env', Cap_1)
  in let <V2> = apply Fnref0(Env1, X1)
  in let <Fnref3> = call 'maps':'get'('__fn', Cap_0)
  in let <Env4> = call 'maps':'get'('__env', Cap_0)
  in let <V5> = apply Fnref3(Env4, V2)
  in V5

'closure_22'/2 = fun (Env0, G1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', Cap_0}, {'v1', G1}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_23'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_21'/2 = fun (Env0, F1) ->
  let <Env_cls2> = call 'maps':'from_list'([{'v0', F1}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_22'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_21'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## add1 (let)
module 'yap_main' ['main'/0, 'closure_13'/2]
attributes []

'closure_13'/2 = fun (Env0, X1) ->
  let <V0> = 1
  in let <V1> = call 'erlang':'+'(X1, V0)
  in V1

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_13'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## add5 (let)
module 'yap_main' ['main'/0, 'closure_13'/2]
attributes []

'closure_13'/2 = fun (Env0, X1) ->
  let <V0> = 5
  in let <V1> = call 'erlang':'+'(X1, V0)
  in V1

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_13'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## double (let)
module 'yap_main' ['main'/0, 'closure_13'/2]
attributes []

'closure_13'/2 = fun (Env0, X1) ->
  let <V0> = 2
  in let <V1> = call 'erlang':'*'(X1, V0)
  in V1

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_13'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## add1ThenDouble (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = Compose
in let <V1> = Double
in let <Fnref2> = call 'maps':'get'('__fn', V0)
in let <Env3> = call 'maps':'get'('__env', V0)
in let <V4> = apply Fnref2(Env3, V1)
in let <V5> = Add1
in let <Fnref6> = call 'maps':'get'('__fn', V4)
in let <Env7> = call 'maps':'get'('__env', V4)
in let <V8> = apply Fnref6(Env7, V5)
in V8
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

