## (expr) (expression)
module 'yap_main' ['main'/0, 'closure_72'/2, 'closure_71'/2, 'closure_70'/2, 'closure_69'/2, 'closure_68'/2, 'closure_67'/2, 'closure_66'/2, 'closure_65'/2, 'closure_64'/2]
attributes []

'closure_72'/2 = fun (Env0, X1) ->
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
      let <V5> = call 'maps':'get'('payload', X1)
      in let <A> = V5
      in let <V6> = 0
      in apply 'join3'/1(V6)

    'case5'/0 = fun () ->
      let <V6> = call 'maps':'get'('payload', X1)
      in let <V7> = call 'maps':'get'('0', V6)
      in let <El> = V7
      in let <V8> = call 'maps':'get'('1', V6)
      in let <Rest> = V8
      in let <V9> = 1
      in apply 'join3'/1(V9)

    'join3'/1 = fun (Match1) ->
      Match1
  in apply 'entry'/0()

'closure_71'/2 = fun (Env0, C1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([])
  in let <Fnref_cls2> = fun 'yap_main':'closure_72'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_70'/2 = fun (Env0, C1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', Cap_0}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_71'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_69'/2 = fun (Env0, B1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', Cap_0}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_70'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_68'/2 = fun (Env0, B1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', Cap_0}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_69'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_67'/2 = fun (Env0, S1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', Cap_0}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_68'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_66'/2 = fun (Env0, R1) ->
  let <Cap_0> = call 'maps':'get'('v0', Env0)
  in let <Env_cls2> = call 'maps':'from_list'([{'v0', Cap_0}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_67'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_65'/2 = fun (Env0, A1) ->
  let <Env_cls2> = call 'maps':'from_list'([{'v0', A1}])
  in let <Fnref_cls2> = fun 'yap_main':'closure_66'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'closure_64'/2 = fun (Env0, A1) ->
  let <Env_cls2> = call 'maps':'from_list'([])
  in let <Fnref_cls2> = fun 'yap_main':'closure_65'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_64'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

