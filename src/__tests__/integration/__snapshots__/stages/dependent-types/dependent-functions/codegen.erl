## makeType (let)
module 'yap_main' ['main'/0, 'closure_19'/2]
attributes []

'closure_19'/2 = fun (Env0, B1) ->
  letrec
    'entry'/0 = fun () ->
      let <Cap_0> = call 'maps':'get'('v0', Env0)
      in let <Cap_1> = call 'maps':'get'('v1', Env0)
      in apply 'sw1'/0()

    'sw1'/0 = fun () ->
      case case B1 of
  <_A> when call 'erlang':'is_atom'(_A) ->
    call 'erlang':'atom_to_list'(_A)
  <_N> when call 'erlang':'is_integer'(_N) ->
    call 'erlang':'integer_to_list'(_N)
  <_L> when 'true' ->
    _L
end of
        <"true"> when 'true' ->
          apply 'case3'/0()
        <"false"> when 'true' ->
          apply 'case4'/0()
      end

    'case3'/0 = fun () ->
      apply 'join2'/1(Cap_0)

    'case4'/0 = fun () ->
      apply 'join2'/1(Cap_1)

    'join2'/1 = fun (Match0) ->
      Match0
  in apply 'entry'/0()

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([{'v0', Num}, {'v1', String}])
in let <Fnref_cls2> = fun 'yap_main':'closure_19'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## T1 (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = MakeType
in let <V1> = 'true'
in let <Fnref2> = call 'maps':'get'('__fn', V0)
in let <Env3> = call 'maps':'get'('__env', V0)
in let <V4> = apply Fnref2(Env3, V1)
in V4
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## T2 (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = MakeType
in let <V1> = 'false'
in let <Fnref2> = call 'maps':'get'('__fn', V0)
in let <Env3> = call 'maps':'get'('__env', V0)
in let <V4> = apply Fnref2(Env3, V1)
in V4
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

