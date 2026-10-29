## Nat (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = V0
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## Pos (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = V0
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## hof (let)
module 'yap_main' ['main'/0, 'closure_13'/2]
attributes []

'closure_13'/2 = fun (Env0, F1) ->
  let <V0> = 1
  in let <Fnref1> = call 'maps':'get'('__fn', F1)
  in let <Env2> = call 'maps':'get'('__env', F1)
  in let <V3> = apply Fnref1(Env2, V0)
  in V3

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_13'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## hof2 (let)
module 'yap_main' ['main'/0, 'closure_18'/2]
attributes []

'closure_18'/2 = fun (Env0, F1) ->
  let <V0> = 1
  in let <Fnref1> = call 'maps':'get'('__fn', F1)
  in let <Env2> = call 'maps':'get'('__env', F1)
  in let <V3> = apply Fnref1(Env2, V0)
  in let <V4> = 1
  in let <V5> = call 'erlang':'+'(V3, V4)
  in V5

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_18'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

