## stringify (foreign)


## Show (let)
module 'yap_main' ['main'/0, 'closure_18'/2]
attributes []

'closure_18'/2 = fun (Env0, T1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <V0> = call 'maps':'from_list'([])
  in V0

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([{'v0', String}])
in let <Fnref_cls2> = fun 'yap_main':'closure_18'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## Eq (let)
module 'yap_main' ['main'/0, 'closure_20'/2]
attributes []

'closure_20'/2 = fun (Env0, T1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <V0> = call 'maps':'from_list'([])
  in V0

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([{'v0', Bool}])
in let <Fnref_cls2> = fun 'yap_main':'closure_20'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## ShowNum (let)
module 'yap_main' ['main'/0, 'pap_fn1'/2]
attributes []

'pap_fn1'/2 = fun (Env2, Arg3) ->
  let <Cap_0> = call 'maps':'get'('v0', Env2)
  in let <Result_pap_fn1> = apply Stringify(Cap_0, Arg3)
  in Result_pap_fn1

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 'Num'
in let <Env_cls1> = call 'maps':'from_list'([{'v0', V0}])
in let <Fnref_cls1> = fun 'yap_main':'pap_fn1'/2
in let <Closure_cls1> = call 'maps':'from_list'([{'__fn', Fnref_cls1}, {'__env', Env_cls1}])
in let <V2> = call 'maps':'from_list'([{'show', Closure_cls1}])
in V2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## ShowBool (let)
module 'yap_main' ['main'/0, 'closure_19'/2]
attributes []

'closure_19'/2 = fun (Env0, B1) ->
  letrec
    'entry'/0 = fun () ->
      apply 'sw1'/0()

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
      let <V4> = "true"
      in apply 'join2'/1(V4)

    'case4'/0 = fun () ->
      let <V5> = "false"
      in apply 'join2'/1(V5)

    'join2'/1 = fun (Match0) ->
      Match0
  in apply 'entry'/0()

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_19'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in let <V3> = call 'maps':'from_list'([{'show', Closure_cls2}])
in V3
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## EqNum (let)
error: emit_erl: unknown function arity for "unknown"
