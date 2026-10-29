## getX (let)
module 'yap_main' ['main'/0, 'closure_20'/2, 'closure_19'/2]
attributes []

'closure_20'/2 = fun (Env0, Record1) ->
  let <V0> = call 'maps':'get'('x', Record1)
  in V0

'closure_19'/2 = fun (Env0, R1) ->
  let <Env_cls2> = call 'maps':'from_list'([])
  in let <Fnref_cls2> = fun 'yap_main':'closure_20'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_19'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## p1 (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = GetX
in let <V1> = 'Num'
in let <V2> = call 'maps':'from_list'([{'y', V1}])
in let <Fnref3> = call 'maps':'get'('__fn', V0)
in let <Env4> = call 'maps':'get'('__env', V0)
in let <V5> = apply Fnref3(Env4, V2)
in let <V6> = 10
in let <V7> = 20
in let <V8> = call 'maps':'from_list'([{'x', V6}, {'y', V7}])
in let <Fnref9> = call 'maps':'get'('__fn', V5)
in let <Env10> = call 'maps':'get'('__env', V5)
in let <V11> = apply Fnref9(Env10, V8)
in V11
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## p2 (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = GetX
in let <V1> = 'Num'
in let <V2> = 'Num'
in let <V3> = call 'maps':'from_list'([{'y', V1}, {'z', V2}])
in let <Fnref4> = call 'maps':'get'('__fn', V0)
in let <Env5> = call 'maps':'get'('__env', V0)
in let <V6> = apply Fnref4(Env5, V3)
in let <V7> = 5
in let <V8> = 3
in let <V9> = 7
in let <V10> = call 'maps':'from_list'([{'x', V7}, {'y', V8}, {'z', V9}])
in let <Fnref11> = call 'maps':'get'('__fn', V6)
in let <Env12> = call 'maps':'get'('__env', V6)
in let <V13> = apply Fnref11(Env12, V10)
in V13
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## p3 (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = GetX
in let <V1> = 'String'
in let <V2> = call 'maps':'from_list'([{'name', V1}])
in let <Fnref3> = call 'maps':'get'('__fn', V0)
in let <Env4> = call 'maps':'get'('__env', V0)
in let <V5> = apply Fnref3(Env4, V2)
in let <V6> = 100
in let <V7> = "point"
in let <V8> = call 'maps':'from_list'([{'x', V6}, {'name', V7}])
in let <Fnref9> = call 'maps':'get'('__fn', V5)
in let <Env10> = call 'maps':'get'('__env', V5)
in let <V11> = apply Fnref9(Env10, V8)
in V11
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

