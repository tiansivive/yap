## Factorial (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = call 'maps':'from_list'([])
in V0
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## fact (let)
module 'yap_main' ['main'/0, 'closure_33'/2]
attributes []

'closure_33'/2 = fun (Env1, N2) ->
  letrec
    'entry'/0 = fun () ->
      let <Cap_0> = call 'maps':'get'('v0', Env1)
      in apply 'sw2'/0()

    'sw2'/0 = fun () ->
      case case N2 of
  <_A> when call 'erlang':'is_atom'(_A) ->
    call 'erlang':'atom_to_list'(_A)
  <_N> when call 'erlang':'is_integer'(_N) ->
    call 'erlang':'integer_to_list'(_N)
  <_L> when 'true' ->
    _L
end of
        <"0"> when 'true' ->
          apply 'case4'/0()
        <_> when 'true' ->
          apply 'default5'/0()
      end

    'case4'/0 = fun () ->
      let <V5> = 1
      in apply 'join3'/1(V5)

    'default5'/0 = fun () ->
      let <V6> = call 'maps':'get'('compute', Cap_0)
      in let <V7> = 1
      in let <V8> = call 'erlang':'-'(N2, V7)
      in let <Fnref9> = call 'maps':'get'('__fn', V6)
      in let <Env10> = call 'maps':'get'('__env', V6)
      in let <V11> = apply Fnref9(Env10, V8)
      in let <V12> = call 'erlang':'*'(N2, V11)
      in apply 'join3'/1(V12)

    'join3'/1 = fun (Match1) ->
      Match1
  in apply 'entry'/0()

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = call 'maps':'from_list'([])
in let <Env_cls3> = call 'maps':'from_list'([{'v0', V0}])
in let <Fnref_cls3> = fun 'yap_main':'closure_33'/2
in let <Closure_cls3> = call 'maps':'from_list'([{'__fn', Fnref_cls3}, {'__env', Env_cls3}])
in let <V0_fbip_0> = call 'maps':'put'('compute', Closure_cls3, V0)
in V0
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## result (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = Fact
in let <V1> = call 'maps':'get'('compute', V0)
in let <V2> = 5
in let <Fnref3> = call 'maps':'get'('__fn', V1)
in let <Env4> = call 'maps':'get'('__env', V1)
in let <V5> = apply Fnref3(Env4, V2)
in V5
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

