## addZ (let)
module 'yap_main' ['main'/0, 'closure_25'/2, 'closure_24'/2]
attributes []

'closure_25'/2 = fun (Env0, Rec1) ->
  let <V0> = 0
  in let <V1> = call 'maps':'merge'(Rec1, call 'maps':'from_list'([{'z', V0}]))
  in V1

'closure_24'/2 = fun (Env0, R1) ->
  let <Env_cls2> = call 'maps':'from_list'([])
  in let <Fnref_cls2> = fun 'yap_main':'closure_25'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_24'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## p1 (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = AddZ
in let <V1> = call 'maps':'from_list'([])
in let <Fnref2> = call 'maps':'get'('__fn', V0)
in let <Env3> = call 'maps':'get'('__env', V0)
in let <V4> = apply Fnref2(Env3, V1)
in let <V5> = 1
in let <V6> = 2
in let <V7> = call 'maps':'from_list'([{'x', V5}, {'y', V6}])
in let <Fnref8> = call 'maps':'get'('__fn', V4)
in let <Env9> = call 'maps':'get'('__env', V4)
in let <V10> = apply Fnref8(Env9, V7)
in V10
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## p2 (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = AddZ
in let <V1> = 'String'
in let <V2> = call 'maps':'from_list'([{'color', V1}])
in let <Fnref3> = call 'maps':'get'('__fn', V0)
in let <Env4> = call 'maps':'get'('__env', V0)
in let <V5> = apply Fnref3(Env4, V2)
in let <V6> = 5
in let <V7> = 10
in let <V8> = "red"
in let <V9> = call 'maps':'from_list'([{'x', V6}, {'y', V7}, {'color', V8}])
in let <Fnref10> = call 'maps':'get'('__fn', V5)
in let <Env11> = call 'maps':'get'('__env', V5)
in let <V12> = apply Fnref10(Env11, V9)
in V12
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

