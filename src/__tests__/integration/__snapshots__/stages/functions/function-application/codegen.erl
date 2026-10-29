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


## add (let)
error: emit_erl: unknown function arity for "unknown"

## forty2 (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = Identity
in let <V1> = 42
in let <Fnref2> = call 'maps':'get'('__fn', V0)
in let <Env3> = call 'maps':'get'('__env', V0)
in let <V4> = apply Fnref2(Env3, V1)
in V4
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## added (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = Add
in let <V1> = 10
in let <Fnref2> = call 'maps':'get'('__fn', V0)
in let <Env3> = call 'maps':'get'('__env', V0)
in let <V4> = apply Fnref2(Env3, V1)
in let <V5> = 20
in let <Fnref6> = call 'maps':'get'('__fn', V4)
in let <Env7> = call 'maps':'get'('__env', V4)
in let <V8> = apply Fnref6(Env7, V5)
in V8
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

