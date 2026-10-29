## (expr) (expression)
module 'yap_main' ['main'/0, 'closure_22'/2, 'closure_21'/2, 'closure_20'/2]
attributes []

'closure_22'/2 = fun (Env0, Obj1) ->
  let <V0> = call 'maps':'get'('x', Obj1)
  in V0

'closure_21'/2 = fun (Env0, A1) ->
  let <Env_cls2> = call 'maps':'from_list'([])
  in let <Fnref_cls2> = fun 'yap_main':'closure_22'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_20'/2 = fun (Env0, R1) ->
  let <Env_cls2> = call 'maps':'from_list'([])
  in let <Fnref_cls2> = fun 'yap_main':'closure_21'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_20'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in let <Proj3> = Closure_cls2
in let <V4> = 'nil'
in V4
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

