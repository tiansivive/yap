## identity (let)
module 'yap_main' ['main'/0, 'closure_7'/2]
attributes []

'closure_7'/2 = fun (Env0, X1) ->
  X1

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_7'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## const (let)
module 'yap_main' ['main'/0, 'closure_11'/2, 'closure_10'/2]
attributes []

'closure_11'/2 = fun (Env0, Y1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in Cap_0

'closure_10'/2 = fun (Env0, X1) ->
  let <Env_cls2> = call 'maps':'from_list'([{'v0', X1}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_11'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_10'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

