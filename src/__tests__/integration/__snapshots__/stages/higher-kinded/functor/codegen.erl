## List (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = call 'maps':'from_list'([])
in V0
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


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


## mapList (let)
module 'yap_main' ['main'/0, 'closure_63'/2, 'closure_62'/2, 'closure_61'/2, 'closure_60'/2]
attributes []

'closure_63'/2 = fun (Env0, List1) ->
  letrec
    'entry'/0 = fun () ->
      let <Cap_0> = call 'maps':'get'('v0', Env0)
      in let <Cap_1> = call 'maps':'get'('v1', Env0)
      in let <Cap_2> = call 'maps':'get'('v2', Env0)
      in let <Cap_3> = call 'maps':'get'('v3', Env0)
      in apply 'sw2'/0()

    'sw2'/0 = fun () ->
      let <Tag0> = call 'maps':'get'('__tag', List1)
      in case case Tag0 of
  <_A> when call 'erlang':'is_atom'(_A) ->
    call 'erlang':'atom_to_list'(_A)
  <_N> when call 'erlang':'is_integer'(_N) ->
    call 'erlang':'integer_to_list'(_N)
  <_L> when 'true' ->
    _L
end of
        <"nil"> when 'true' ->
          apply 'case4'/0()
        <"cons"> when 'true' ->
          apply 'case5'/0()
      end

    'case4'/0 = fun () ->
      let <V5> = 'nil'
      in let <V6> = 'nil'
      in let <V7> = call 'maps':'from_list'([{'__tag', V5}, {'payload', V6}])
      in apply 'join3'/1(V7)

    'case5'/0 = fun () ->
      let <V6> = call 'maps':'get'('payload', List1)
      in let <V7> = call 'maps':'get'('0', V6)
      in let <X> = V7
      in let <V8> = call 'maps':'get'('1', V6)
      in let <Xs> = V8
      in let <V9> = 'cons'
      in let <Fnref10> = call 'maps':'get'('__fn', Cap_0)
      in let <Env11> = call 'maps':'get'('__env', Cap_0)
      in let <V12> = apply Fnref10(Env11, X)
      in let <Fnref13> = call 'maps':'get'('__fn', Cap_1)
      in let <Env14> = call 'maps':'get'('__env', Cap_1)
      in let <V15> = apply Fnref13(Env14, Cap_2)
      in let <Fnref16> = call 'maps':'get'('__fn', V15)
      in let <Env17> = call 'maps':'get'('__env', V15)
      in let <V18> = apply Fnref16(Env17, Cap_3)
      in let <Fnref19> = call 'maps':'get'('__fn', V18)
      in let <Env20> = call 'maps':'get'('__env', V18)
      in let <V21> = apply Fnref19(Env20, Cap_0)
      in let <Fnref22> = call 'maps':'get'('__fn', V21)
      in let <Env23> = call 'maps':'get'('__env', V21)
      in let <V24> = apply Fnref22(Env23, Xs)
      in let <V25> = call 'maps':'from_list'([{'0', V12}, {'1', V24}])
      in let <V26> = call 'maps':'from_list'([{'__tag', V9}, {'payload', V25}])
      in apply 'join3'/1(V26)

    'join3'/1 = fun (Match1) ->
      Match1
  in apply 'entry'/0()

'closure_62'/2 = fun (Env0, F1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Cap_1> = call 'maps':'get'('v1', Env0)
  in let <Cap_2> = call 'maps':'get'('v2', Env0)
  in let <Cap_3> = call 'maps':'get'('v3', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', F1}, {'v1', Cap_2}, {'v2', Cap_1}, {'v3', Cap_3}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_63'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_61'/2 = fun (Env0, B1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Cap_1> = call 'maps':'get'('v1', Env0)
  in let <Cap_2> = call 'maps':'get'('v2', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', Cap_1}, {'v1', Cap_0}, {'v2', Cap_2}, {'v3', B1}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_62'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_60'/2 = fun (Env0, A1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Cap_1> = call 'maps':'get'('v1', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', A1}, {'v1', Cap_0}, {'v2', Cap_1}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_61'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([{'v0', List}, {'v1', MapList}])
in let <Fnref_cls2> = fun 'yap_main':'closure_60'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## ListFunctor (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = MapList
in let <V1> = call 'maps':'from_list'([{'map', V0}])
in V1
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

