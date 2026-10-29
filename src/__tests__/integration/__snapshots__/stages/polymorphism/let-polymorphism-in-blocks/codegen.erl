## letpoly (let)
module 'yap_main' ['main'/0, 'closure_26'/2, 'closure_25'/2]
attributes []

'closure_26'/2 = fun (Env0, X1) ->
  X1

'closure_25'/2 = fun (Env0, A1) ->
  let <Env_cls2> = call 'maps':'from_list'([])
  in let <Fnref_cls2> = fun 'yap_main':'closure_26'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_25'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in let <InnerID3> = Closure_cls2
in let <V4> = 'Num'
in let <Fnref5> = call 'maps':'get'('__fn', InnerID3)
in let <Env6> = call 'maps':'get'('__env', InnerID3)
in let <V7> = apply Fnref5(Env6, V4)
in let <V8> = 42
in let <Fnref9> = call 'maps':'get'('__fn', V7)
in let <Env10> = call 'maps':'get'('__env', V7)
in let <V11> = apply Fnref9(Env10, V8)
in let <N12> = V11
in let <V13> = 'String'
in let <Fnref14> = call 'maps':'get'('__fn', InnerID3)
in let <Env15> = call 'maps':'get'('__env', InnerID3)
in let <V16> = apply Fnref14(Env15, V13)
in let <V17> = "hi"
in let <Fnref18> = call 'maps':'get'('__fn', V16)
in let <Env19> = call 'maps':'get'('__env', V16)
in let <V20> = apply Fnref18(Env19, V17)
in let <S21> = V20
in N12
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

