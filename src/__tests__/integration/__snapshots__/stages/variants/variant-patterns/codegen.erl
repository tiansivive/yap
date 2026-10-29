## Shape (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = call 'maps':'from_list'([])
in let <V1> = Num
in let <V2> = call 'maps':'from_list'([{'1', V1}, {'0', V1}])
in let <V3> = call 'maps':'from_list'([{'point', V0}, {'rectangle', V2}, {'circle', V1}])
in V3
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## describeShape (let)
module 'yap_main' ['main'/0, 'closure_68'/2]
attributes []

'closure_68'/2 = fun (Env0, S1) ->
  letrec
    'entry'/0 = fun () ->
      apply 'sw2'/0()

    'sw2'/0 = fun () ->
      let <Tag0> = call 'maps':'get'('__tag', S1)
      in case case Tag0 of
  <_A> when call 'erlang':'is_atom'(_A) ->
    call 'erlang':'atom_to_list'(_A)
  <_N> when call 'erlang':'is_integer'(_N) ->
    call 'erlang':'integer_to_list'(_N)
  <_L> when 'true' ->
    _L
end of
        <"circle"> when 'true' ->
          apply 'case4'/0()
        <"rectangle"> when 'true' ->
          apply 'case5'/0()
        <"point"> when 'true' ->
          apply 'case6'/0()
      end

    'case4'/0 = fun () ->
      let <V5> = call 'maps':'get'('payload', S1)
      in let <R> = V5
      in let <V6> = "Circle with radius"
      in apply 'join3'/1(V6)

    'case5'/0 = fun () ->
      let <V6> = call 'maps':'get'('payload', S1)
      in let <V7> = call 'maps':'get'('0', V6)
      in let <W> = V7
      in let <V8> = call 'maps':'get'('1', V6)
      in let <H> = V8
      in let <V9> = "Rectangle"
      in apply 'join3'/1(V9)

    'case6'/0 = fun () ->
      let <V7> = call 'maps':'get'('payload', S1)
      in let <V8> = "Point at coordinates"
      in apply 'join3'/1(V8)

    'join3'/1 = fun (Match1) ->
      Match1
  in apply 'entry'/0()

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_68'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

