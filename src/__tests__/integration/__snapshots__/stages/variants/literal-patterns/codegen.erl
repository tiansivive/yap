## isZero (let)
module 'yap_main' ['main'/0, 'closure_17'/2]
attributes []

'closure_17'/2 = fun (Env0, N1) ->
  letrec
    'entry'/0 = fun () ->
      apply 'sw1'/0()

    'sw1'/0 = fun () ->
      case case N1 of
  <_A> when call 'erlang':'is_atom'(_A) ->
    call 'erlang':'atom_to_list'(_A)
  <_N> when call 'erlang':'is_integer'(_N) ->
    call 'erlang':'integer_to_list'(_N)
  <_L> when 'true' ->
    _L
end of
        <"0"> when 'true' ->
          apply 'case3'/0()
        <_> when 'true' ->
          apply 'default4'/0()
      end

    'case3'/0 = fun () ->
      let <V4> = 'true'
      in apply 'join2'/1(V4)

    'default4'/0 = fun () ->
      let <V5> = 'false'
      in apply 'join2'/1(V5)

    'join2'/1 = fun (Match0) ->
      Match0
  in apply 'entry'/0()

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_17'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

