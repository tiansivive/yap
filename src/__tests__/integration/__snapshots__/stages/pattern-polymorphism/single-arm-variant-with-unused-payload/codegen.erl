## (expr) (expression)
module 'yap_main' ['main'/0, 'closure_31'/2, 'closure_30'/2, 'closure_29'/2, 'closure_28'/2]
attributes []

'closure_31'/2 = fun (Env0, X1) ->
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
      end

    'case4'/0 = fun () ->
      let <V5> = call 'maps':'get'('payload', X1)
      in let <A> = V5
      in let <V6> = 0
      in apply 'join3'/1(V6)

    'join3'/1 = fun (Match1) ->
      Match1
  in apply 'entry'/0()

'closure_30'/2 = fun (Env0, A1) ->
  let <Env_cls2> = call 'maps':'from_list'([])
  in let <Fnref_cls2> = fun 'yap_main':'closure_31'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_29'/2 = fun (Env0, A1) ->
  let <Env_cls2> = call 'maps':'from_list'([])
  in let <Fnref_cls2> = fun 'yap_main':'closure_30'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_28'/2 = fun (Env0, R1) ->
  let <Env_cls2> = call 'maps':'from_list'([])
  in let <Fnref_cls2> = fun 'yap_main':'closure_29'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_28'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

