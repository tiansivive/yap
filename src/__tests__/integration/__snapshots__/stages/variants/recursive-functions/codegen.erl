## List (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = call 'maps':'from_list'([])
in V0
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## length (let)
module 'yap_main' ['main'/0, 'closure_46'/2, 'closure_45'/2]
attributes []

'closure_46'/2 = fun (Env0, List1) ->
  letrec
    'entry'/0 = fun () ->
      let <Cap_0> = call 'maps':'get'('v0', Env0)
      in let <Cap_1> = call 'maps':'get'('v1', Env0)
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
      let <V5> = 0
      in apply 'join3'/1(V5)

    'case5'/0 = fun () ->
      let <V6> = call 'maps':'get'('payload', List1)
      in let <V7> = call 'maps':'get'('0', V6)
      in let <X> = V7
      in let <V8> = call 'maps':'get'('1', V6)
      in let <Xs> = V8
      in let <V9> = 1
      in let <Fnref10> = call 'maps':'get'('__fn', Cap_0)
      in let <Env11> = call 'maps':'get'('__env', Cap_0)
      in let <V12> = apply Fnref10(Env11, Cap_1)
      in let <Fnref13> = call 'maps':'get'('__fn', V12)
      in let <Env14> = call 'maps':'get'('__env', V12)
      in let <V15> = apply Fnref13(Env14, Xs)
      in let <V16> = call 'erlang':'+'(V9, V15)
      in apply 'join3'/1(V16)

    'join3'/1 = fun (Match1) ->
      Match1
  in apply 'entry'/0()

'closure_45'/2 = fun (Env0, A1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Cap_1> = call 'maps':'get'('v1', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', Cap_1}, {'v1', A1}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_46'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([{'v0', List}, {'v1', Length}])
in let <Fnref_cls2> = fun 'yap_main':'closure_45'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

