## stringify (foreign)


## Show (let)
module 'yap_main' ['main'/0, 'closure_18'/2]
attributes []

'closure_18'/2 = fun (Env0, T1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <V0> = call 'maps':'from_list'([])
  in V0

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([{'v0', String}])
in let <Fnref_cls2> = fun 'yap_main':'closure_18'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## Eq (let)
module 'yap_main' ['main'/0, 'closure_20'/2]
attributes []

'closure_20'/2 = fun (Env0, T1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <V0> = call 'maps':'from_list'([])
  in V0

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([{'v0', Bool}])
in let <Fnref_cls2> = fun 'yap_main':'closure_20'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## ShowNum (let)
module 'yap_main' ['main'/0, 'pap_fn1'/2]
attributes []

'pap_fn1'/2 = fun (Env2, Arg3) ->
  let <Cap_0> = call 'maps':'get'('v0', Env2)
  in let <Result_pap_fn1> = apply Stringify(Cap_0, Arg3)
  in Result_pap_fn1

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 'Num'
in let <Env_cls1> = call 'maps':'from_list'([{'v0', V0}])
in let <Fnref_cls1> = fun 'yap_main':'pap_fn1'/2
in let <Closure_cls1> = call 'maps':'from_list'([{'__fn', Fnref_cls1}, {'__env', Env_cls1}])
in let <V2> = call 'maps':'from_list'([{'show', Closure_cls1}])
in V2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## EqNum (let)
error: emit_erl: unknown function arity for "unknown"

## display (let)
module 'yap_main' ['main'/0, 'closure_19'/2, 'closure_18'/2]
attributes []

'closure_19'/2 = fun (Env0, Show1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <V0> = call 'maps':'get'('show', Show1)
  in V0

'closure_18'/2 = fun (Env0, T1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', T1}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_19'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([{'v0', Show}])
in let <Fnref_cls2> = fun 'yap_main':'closure_18'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## areEqual (let)
module 'yap_main' ['main'/0, 'closure_23'/2, 'closure_22'/2]
attributes []

'closure_23'/2 = fun (Env0, Eq1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <V0> = call 'maps':'get'('eq', Eq1)
  in V0

'closure_22'/2 = fun (Env0, T1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', T1}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_23'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([{'v0', Eq}])
in let <Fnref_cls2> = fun 'yap_main':'closure_22'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## (using) (using)


## (using) (using)


## shown (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = Display
in let <V1> = 'Num'
in let <Fnref2> = call 'maps':'get'('__fn', V0)
in let <Env3> = call 'maps':'get'('__env', V0)
in let <V4> = apply Fnref2(Env3, V1)
in let <V5> = ShowNum
in let <Fnref6> = call 'maps':'get'('__fn', V4)
in let <Env7> = call 'maps':'get'('__env', V4)
in let <V8> = apply Fnref6(Env7, V5)
in let <V9> = 42
in let <Fnref10> = call 'maps':'get'('__fn', V8)
in let <Env11> = call 'maps':'get'('__env', V8)
in let <V12> = apply Fnref10(Env11, V9)
in V12
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## same (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = AreEqual
in let <V1> = 'Num'
in let <Fnref2> = call 'maps':'get'('__fn', V0)
in let <Env3> = call 'maps':'get'('__env', V0)
in let <V4> = apply Fnref2(Env3, V1)
in let <V5> = EqNum
in let <Fnref6> = call 'maps':'get'('__fn', V4)
in let <Env7> = call 'maps':'get'('__env', V4)
in let <V8> = apply Fnref6(Env7, V5)
in let <V9> = 10
in let <Fnref10> = call 'maps':'get'('__fn', V8)
in let <Env11> = call 'maps':'get'('__env', V8)
in let <V12> = apply Fnref10(Env11, V9)
in let <V13> = 10
in let <Fnref14> = call 'maps':'get'('__fn', V12)
in let <Env15> = call 'maps':'get'('__env', V12)
in let <V16> = apply Fnref14(Env15, V13)
in V16
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

