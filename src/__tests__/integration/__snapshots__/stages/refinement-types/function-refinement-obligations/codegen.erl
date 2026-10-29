## fn (let)
module 'yap_main' ['main'/0, 'closure_7'/2]
attributes []

'closure_7'/2 = fun (Env0, X1) ->
  let <V0> = 2
  in V0

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_7'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## posTestCheckLambdaPostCondition (let)
module 'yap_main' ['main'/0, 'closure_7'/2]
attributes []

'closure_7'/2 = fun (Env0, X1) ->
  let <V0> = 1
  in V0

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_7'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## posTestCheckLambdaPreCondition (let)
module 'yap_main' ['main'/0, 'closure_8'/2]
attributes []

'closure_8'/2 = fun (Env0, X1) ->
  X1

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_8'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## posTestCheckLambdaPreAndPostCondition (let)
module 'yap_main' ['main'/0, 'closure_8'/2]
attributes []

'closure_8'/2 = fun (Env0, X1) ->
  X1

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_8'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## posTestCheckRefinedResultLambda (let)
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


## inc (let)
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

