## addImplicit (let)
module 'yap_main' ['main'/0, 'closure_17'/2, 'closure_16'/2]
attributes []

'closure_17'/2 = fun (Env0, X1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <V0> = call 'erlang':'+'(X1, Cap_0)
  in V0

'closure_16'/2 = fun (Env0, N1) ->
  let <Env_cls2> = call 'maps':'from_list'([{'v0', N1}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_17'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_16'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## (using) (using)


## eleven (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = AddImplicit
in let <V1> = 10
in let <Fnref2> = call 'maps':'get'('__fn', V0)
in let <Env3> = call 'maps':'get'('__env', V0)
in let <V4> = apply Fnref2(Env3, V1)
in let <V5> = 1
in let <Fnref6> = call 'maps':'get'('__fn', V4)
in let <Env7> = call 'maps':'get'('__env', V4)
in let <V8> = apply Fnref6(Env7, V5)
in V8
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## fifteen (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = AddImplicit
in let <V1> = 10
in let <Fnref2> = call 'maps':'get'('__fn', V0)
in let <Env3> = call 'maps':'get'('__env', V0)
in let <V4> = apply Fnref2(Env3, V1)
in let <V5> = 5
in let <Fnref6> = call 'maps':'get'('__fn', V4)
in let <Env7> = call 'maps':'get'('__env', V4)
in let <V8> = apply Fnref6(Env7, V5)
in V8
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

