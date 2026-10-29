## getY (let)
module 'yap_main' ['main'/0, 'closure_30'/2]
attributes []

'closure_30'/2 = fun (Env0, P1) ->
  let <V0> = call 'maps':'get'('x', P1)
  in let <A> = V0
  in let <V1> = call 'maps':'get'('y', P1)
  in let <B> = V1
  in B

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_30'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## getY2 (let)
module 'yap_main' ['main'/0, 'closure_28'/2]
attributes []

'closure_28'/2 = fun (Env0, P1) ->
  let <V0> = call 'maps':'get'('y', P1)
  in let <A> = V0
  in A

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_28'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

