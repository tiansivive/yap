## test (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = letrec
  'entry'/0 = fun () ->
    let <B9> = Match4
    in let <V10> = 1
    in apply 'sw5'/0()

  'sw5'/0 = fun () ->
    let <V0> = 1
    in let <A1> = V0
    in let <V2> = 0
    in let <V3> = call 'erlang':'>'(A1, V2)
    in case case V3 of
  <_A> when call 'erlang':'is_atom'(_A) ->
    call 'erlang':'atom_to_list'(_A)
  <_N> when call 'erlang':'is_integer'(_N) ->
    call 'erlang':'integer_to_list'(_N)
  <_L> when 'true' ->
    _L
end of
      <"true"> when 'true' ->
        apply 'case7'/0()
      <"false"> when 'true' ->
        apply 'case8'/0()
    end

  'case7'/0 = fun () ->
    apply 'join6'/1(A1)

  'case8'/0 = fun () ->
    let <V9> = 42
    in apply 'join6'/1(V9)

  'join6'/1 = fun (Match4) ->
    Match4
in apply 'entry'/0()
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

