## stringify (foreign)


## Functor (let)
module 'yap_main' ['main'/0, 'closure_31'/2]
attributes []

'closure_31'/2 = fun (Env0, F1) ->
  let <V0> = call 'maps':'from_list'([])
  in V0

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_31'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## fmap (let)
module 'yap_main' ['main'/0, 'closure_39'/2, 'closure_38'/2, 'closure_37'/2]
attributes []

'closure_39'/2 = fun (Env0, A1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Cap_1> = call 'maps':'get'('v1', Env0)
  in let <Cap_2> = call 'maps':'get'('v2', Env0)
  in Cap_0

'closure_38'/2 = fun (Env0, Functor1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Cap_1> = call 'maps':'get'('v1', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', Cap_0}, {'v1', Cap_1}, {'v2', Functor1}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_39'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_37'/2 = fun (Env0, F1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Cap_1> = call 'maps':'get'('v1', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', Cap_1}, {'v1', F1}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_38'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([{'v0', Functor}, {'v1', Cap1}])
in let <Fnref_cls2> = fun 'yap_main':'closure_37'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## Option (let)
module 'yap_main' ['main'/0, 'closure_13'/2]
attributes []

'closure_13'/2 = fun (Env0, A1) ->
  let <V0> = 'Unit'
  in let <V1> = call 'maps':'from_list'([{'none', V0}, {'some', A1}])
  in V1

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_13'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## mapOption (let)
module 'yap_main' ['main'/0, 'closure_46'/2, 'closure_45'/2, 'closure_44'/2, 'closure_43'/2]
attributes []

'closure_46'/2 = fun (Env0, O1) ->
  letrec
    'entry'/0 = fun () ->
      let <Cap_0> = call 'maps':'get'('v0', Env0)
      in apply 'sw2'/0()

    'sw2'/0 = fun () ->
      let <Tag0> = call 'maps':'get'('__tag', O1)
      in case case Tag0 of
  <_A> when call 'erlang':'is_atom'(_A) ->
    call 'erlang':'atom_to_list'(_A)
  <_N> when call 'erlang':'is_integer'(_N) ->
    call 'erlang':'integer_to_list'(_N)
  <_L> when 'true' ->
    _L
end of
        <"some"> when 'true' ->
          apply 'case4'/0()
        <"none"> when 'true' ->
          apply 'case5'/0()
      end

    'case4'/0 = fun () ->
      let <V5> = call 'maps':'get'('payload', O1)
      in let <X> = V5
      in let <V6> = 'some'
      in let <Fnref7> = call 'maps':'get'('__fn', Cap_0)
      in let <Env8> = call 'maps':'get'('__env', Cap_0)
      in let <V9> = apply Fnref7(Env8, X)
      in let <V10> = call 'maps':'from_list'([{'__tag', V6}, {'payload', V9}])
      in apply 'join3'/1(V10)

    'case5'/0 = fun () ->
      let <V6> = 'none'
      in let <V7> = 'nil'
      in let <V8> = call 'maps':'from_list'([{'__tag', V6}, {'payload', V7}])
      in apply 'join3'/1(V8)

    'join3'/1 = fun (Match1) ->
      Match1
  in apply 'entry'/0()

'closure_45'/2 = fun (Env0, F1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Cap_1> = call 'maps':'get'('v1', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', F1}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_46'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_44'/2 = fun (Env0, B1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Cap_1> = call 'maps':'get'('v1', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', Cap_1}, {'v1', Cap_0}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_45'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_43'/2 = fun (Env0, A1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', A1}, {'v1', Cap_0}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_44'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([{'v0', Option}])
in let <Fnref_cls2> = fun 'yap_main':'closure_43'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## OptionFunctor (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = MapOption
in let <V1> = call 'maps':'from_list'([{'map', V0}])
in V1
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## (using) (using)


## x (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 'some'
in let <V1> = 1
in let <V2> = call 'maps':'from_list'([{'__tag', V0}, {'payload', V1}])
in V2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## y (let)
module 'yap_main' ['main'/0, 'pap_fn18'/2]
attributes []

'pap_fn18'/2 = fun (Env19, Arg20) ->
  let <Cap_0> = call 'maps':'get'('v0', Env19)
  in let <Result_pap_fn18> = apply Stringify(Cap_0, Arg20)
  in Result_pap_fn18

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = Fmap
in let <V1> = Option
in let <Fnref2> = call 'maps':'get'('__fn', V0)
in let <Env3> = call 'maps':'get'('__env', V0)
in let <V4> = apply Fnref2(Env3, V1)
in let <V5> = OptionFunctor
in let <Fnref6> = call 'maps':'get'('__fn', V4)
in let <Env7> = call 'maps':'get'('__env', V4)
in let <V8> = apply Fnref6(Env7, V5)
in let <V9> = 'Num'
in let <Fnref10> = call 'maps':'get'('__fn', V8)
in let <Env11> = call 'maps':'get'('__env', V8)
in let <V12> = apply Fnref10(Env11, V9)
in let <V13> = 'String'
in let <Fnref14> = call 'maps':'get'('__fn', V12)
in let <Env15> = call 'maps':'get'('__env', V12)
in let <V16> = apply Fnref14(Env15, V13)
in let <V17> = 'Num'
in let <Env_cls18> = call 'maps':'from_list'([{'v0', V17}])
in let <Fnref_cls18> = fun 'yap_main':'pap_fn18'/2
in let <Closure_cls18> = call 'maps':'from_list'([{'__fn', Fnref_cls18}, {'__env', Env_cls18}])
in let <Fnref19> = call 'maps':'get'('__fn', V16)
in let <Env20> = call 'maps':'get'('__env', V16)
in let <V21> = apply Fnref19(Env20, Closure_cls18)
in let <V22> = X
in let <Fnref23> = call 'maps':'get'('__fn', V21)
in let <Env24> = call 'maps':'get'('__env', V21)
in let <V25> = apply Fnref23(Env24, V22)
in V25
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

