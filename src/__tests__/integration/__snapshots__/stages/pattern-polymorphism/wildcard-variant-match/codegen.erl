## (expr) (expression)
module 'yap_main' ['main'/0, 'closure_48'/2, 'closure_47'/2, 'closure_46'/2, 'closure_45'/2, 'closure_44'/2, 'closure_43'/2]
attributes []

'closure_48'/2 = fun (Env0, X1) ->
  letrec
    'entry'/0 = fun () ->
      apply 'sw2'/0()

    'sw2'/0 = fun () ->
      let <Tag0> = call 'maps':'get'('__tag', X1)
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
      let <V6> = 1
      in apply 'join3'/1(V6)

    'join3'/1 = fun (Match1) ->
      Match1
  in apply 'entry'/0()

'closure_47'/2 = fun (Env0, B1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([])
  in let <Fnref_cls2> = fun 'yap_main':'closure_48'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_46'/2 = fun (Env0, B1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', Cap_0}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_47'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_45'/2 = fun (Env0, R1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', Cap_0}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_46'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_44'/2 = fun (Env0, A1) ->
  let <Env_cls2> = call 'maps':'from_list'([{'v0', A1}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_45'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_43'/2 = fun (Env0, A1) ->
  let <Env_cls2> = call 'maps':'from_list'([])
  in let <Fnref_cls2> = fun 'yap_main':'closure_44'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_43'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

