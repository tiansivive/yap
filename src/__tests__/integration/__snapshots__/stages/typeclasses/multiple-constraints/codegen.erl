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

## displayIfEqual (let)
module 'yap_main' ['main'/0, 'closure_69'/2, 'closure_68'/2, 'closure_67'/2, 'closure_66'/2, 'closure_65'/2]
attributes []

'closure_69'/2 = fun (Env0, Y1) ->
  letrec
    'entry'/0 = fun () ->
      let <Cap_0> = call 'maps':'get'('v0', Env0)
      in let <Cap_1> = call 'maps':'get'('v1', Env0)
      in let <Cap_2> = call 'maps':'get'('v2', Env0)
      in apply 'sw8'/0()

    'sw8'/0 = fun () ->
      let <V0> = call 'maps':'get'('eq', Cap_0)
      in let <Fnref1> = call 'maps':'get'('__fn', V0)
      in let <Env2> = call 'maps':'get'('__env', V0)
      in let <V3> = apply Fnref1(Env2, Cap_1)
      in let <Fnref4> = call 'maps':'get'('__fn', V3)
      in let <Env5> = call 'maps':'get'('__env', V3)
      in let <V6> = apply Fnref4(Env5, Y1)
      in case case V6 of
  <_A> when call 'erlang':'is_atom'(_A) ->
    call 'erlang':'atom_to_list'(_A)
  <_N> when call 'erlang':'is_integer'(_N) ->
    call 'erlang':'integer_to_list'(_N)
  <_L> when 'true' ->
    _L
end of
        <"true"> when 'true' ->
          apply 'case10'/0()
        <"false"> when 'true' ->
          apply 'case11'/0()
      end

    'case10'/0 = fun () ->
      let <V11> = "Equal: "
      in let <V12> = call 'maps':'get'('show', Cap_2)
      in let <Fnref13> = call 'maps':'get'('__fn', V12)
      in let <Env14> = call 'maps':'get'('__env', V12)
      in let <V15> = apply Fnref13(Env14, Cap_1)
      in let <V16> = call 'erlang':'++'(V11, V15)
      in apply 'join9'/1(V16)

    'case11'/0 = fun () ->
      let <V12> = "Not equal"
      in apply 'join9'/1(V12)

    'join9'/1 = fun (Match7) ->
      Match7
  in apply 'entry'/0()

'closure_68'/2 = fun (Env0, X1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Cap_1> = call 'maps':'get'('v1', Env0)
  in let <Cap_2> = call 'maps':'get'('v2', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', Cap_1}, {'v1', X1}, {'v2', Cap_2}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_69'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_67'/2 = fun (Env0, Eq1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Cap_1> = call 'maps':'get'('v1', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', Cap_0}, {'v1', Eq1}, {'v2', Cap_1}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_68'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_66'/2 = fun (Env0, Show1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', Cap_0}, {'v1', Show1}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_67'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_65'/2 = fun (Env0, T1) ->
  let <Env_cls2> = call 'maps':'from_list'([{'v0', T1}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_66'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_65'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## (using) (using)


## (using) (using)


## msg (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = DisplayIfEqual
in let <V1> = 'Num'
in let <Fnref2> = call 'maps':'get'('__fn', V0)
in let <Env3> = call 'maps':'get'('__env', V0)
in let <V4> = apply Fnref2(Env3, V1)
in let <V5> = ShowNum
in let <Fnref6> = call 'maps':'get'('__fn', V4)
in let <Env7> = call 'maps':'get'('__env', V4)
in let <V8> = apply Fnref6(Env7, V5)
in let <V9> = EqNum
in let <Fnref10> = call 'maps':'get'('__fn', V8)
in let <Env11> = call 'maps':'get'('__env', V8)
in let <V12> = apply Fnref10(Env11, V9)
in let <V13> = 5
in let <Fnref14> = call 'maps':'get'('__fn', V12)
in let <Env15> = call 'maps':'get'('__env', V12)
in let <V16> = apply Fnref14(Env15, V13)
in let <V17> = 5
in let <Fnref18> = call 'maps':'get'('__fn', V16)
in let <Env19> = call 'maps':'get'('__env', V16)
in let <V20> = apply Fnref18(Env19, V17)
in V20
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

