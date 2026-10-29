## checkNum (let)
module 'yap_main' ['main'/0, 'closure_14'/2, 'closure_13'/2]
attributes []

'closure_14'/2 = fun (Env0, X1) ->
  X1

'closure_13'/2 = fun (Env0, P1) ->
  let <Env_cls2> = call 'maps':'from_list'([])
  in let <Fnref_cls2> = fun 'yap_main':'closure_14'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_13'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## nat5 (let)
module 'yap_main' ['main'/0, 'closure_18'/2]
attributes []

'closure_18'/2 = fun (Env1, N2) ->
  let <V1> = 0
  in let <V2> = call 'erlang':'>='(N2, V1)
  in V2

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = CheckNum
in let <Env_cls3> = call 'maps':'from_list'([])
in let <Fnref_cls3> = fun 'yap_main':'closure_18'/2
in let <Closure_cls3> = call 'maps':'from_list'([{'__fn', Fnref_cls3}, {'__env', Env_cls3}])
in let <Fnref4> = call 'maps':'get'('__fn', V0)
in let <Env5> = call 'maps':'get'('__env', V0)
in let <V6> = apply Fnref4(Env5, Closure_cls3)
in let <V7> = 5
in let <Fnref8> = call 'maps':'get'('__fn', V6)
in let <Env9> = call 'maps':'get'('__env', V6)
in let <V10> = apply Fnref8(Env9, V7)
in V10
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

