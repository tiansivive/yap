## abs (let)
module 'yap_main' ['main'/0, 'closure_29'/2]
attributes []

'closure_29'/2 = fun (Env0, X1) ->
  letrec
    'entry'/0 = fun () ->
      apply 'sw3'/0()

    'sw3'/0 = fun () ->
      let <V0> = 0
      in let <V1> = call 'erlang':'=<'(V0, X1)
      in case case V1 of
  <_A> when call 'erlang':'is_atom'(_A) ->
    call 'erlang':'atom_to_list'(_A)
  <_N> when call 'erlang':'is_integer'(_N) ->
    call 'erlang':'integer_to_list'(_N)
  <_L> when 'true' ->
    _L
end of
        <"true"> when 'true' ->
          apply 'case5'/0()
        <"false"> when 'true' ->
          apply 'case6'/0()
      end

    'case5'/0 = fun () ->
      apply 'join4'/1(X1)

    'case6'/0 = fun () ->
      let <V7> = 0
      in let <V8> = call 'erlang':'-'(V7, X1)
      in apply 'join4'/1(V8)

    'join4'/1 = fun (Match2) ->
      Match2
  in apply 'entry'/0()

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_29'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## absNegatesBoth (let)
module 'yap_main' ['main'/0, 'closure_34'/2]
attributes []

'closure_34'/2 = fun (Env0, X1) ->
  letrec
    'entry'/0 = fun () ->
      apply 'sw3'/0()

    'sw3'/0 = fun () ->
      let <V0> = 0
      in let <V1> = call 'erlang':'=<'(V0, X1)
      in case case V1 of
  <_A> when call 'erlang':'is_atom'(_A) ->
    call 'erlang':'atom_to_list'(_A)
  <_N> when call 'erlang':'is_integer'(_N) ->
    call 'erlang':'integer_to_list'(_N)
  <_L> when 'true' ->
    _L
end of
        <"true"> when 'true' ->
          apply 'case5'/0()
        <"false"> when 'true' ->
          apply 'case6'/0()
      end

    'case5'/0 = fun () ->
      let <V6> = 0
      in let <V7> = call 'erlang':'-'(V6, X1)
      in apply 'join4'/1(V7)

    'case6'/0 = fun () ->
      let <V7> = 0
      in let <V8> = call 'erlang':'-'(V7, X1)
      in apply 'join4'/1(V8)

    'join4'/1 = fun (Match2) ->
      Match2
  in apply 'entry'/0()

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_34'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## absKeepsBoth (let)
module 'yap_main' ['main'/0, 'closure_23'/2]
attributes []

'closure_23'/2 = fun (Env0, X1) ->
  letrec
    'entry'/0 = fun () ->
      apply 'sw3'/0()

    'sw3'/0 = fun () ->
      let <V0> = 0
      in let <V1> = call 'erlang':'=<'(V0, X1)
      in case case V1 of
  <_A> when call 'erlang':'is_atom'(_A) ->
    call 'erlang':'atom_to_list'(_A)
  <_N> when call 'erlang':'is_integer'(_N) ->
    call 'erlang':'integer_to_list'(_N)
  <_L> when 'true' ->
    _L
end of
        <"true"> when 'true' ->
          apply 'case5'/0()
        <"false"> when 'true' ->
          apply 'case6'/0()
      end

    'case5'/0 = fun () ->
      apply 'join4'/1(X1)

    'case6'/0 = fun () ->
      apply 'join4'/1(X1)

    'join4'/1 = fun (Match2) ->
      Match2
  in apply 'entry'/0()

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_23'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

