## getName (let)
module 'yap_main' ['main'/0, 'closure_20'/2, 'closure_19'/2]
attributes []

'closure_20'/2 = fun (Env0, Obj1) ->
  let <V0> = call 'maps':'get'('name', Obj1)
  in V0

'closure_19'/2 = fun (Env0, R1) ->
  let <Env_cls2> = call 'maps':'from_list'([])
  in let <Fnref_cls2> = fun 'yap_main':'closure_20'/2
  in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
  in Closure_cls2

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_19'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## person (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = "Alice"
in let <V1> = 30
in let <V2> = call 'maps':'from_list'([{'name', V0}, {'age', V1}])
in V2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## book (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = "1984"
in let <V1> = "Orwell"
in let <V2> = 328
in let <V3> = call 'maps':'from_list'([{'name', V0}, {'author', V1}, {'pages', V2}])
in V3
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## n1 (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = GetName
in let <V1> = 'Num'
in let <V2> = call 'maps':'from_list'([{'age', V1}])
in let <Fnref3> = call 'maps':'get'('__fn', V0)
in let <Env4> = call 'maps':'get'('__env', V0)
in let <V5> = apply Fnref3(Env4, V2)
in let <V6> = Person
in let <Fnref7> = call 'maps':'get'('__fn', V5)
in let <Env8> = call 'maps':'get'('__env', V5)
in let <V9> = apply Fnref7(Env8, V6)
in V9
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## n2 (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = GetName
in let <V1> = 'String'
in let <V2> = 'Num'
in let <V3> = call 'maps':'from_list'([{'author', V1}, {'pages', V2}])
in let <Fnref4> = call 'maps':'get'('__fn', V0)
in let <Env5> = call 'maps':'get'('__env', V0)
in let <V6> = apply Fnref4(Env5, V3)
in let <V7> = Book
in let <Fnref8> = call 'maps':'get'('__fn', V6)
in let <Env9> = call 'maps':'get'('__env', V6)
in let <V10> = apply Fnref8(Env9, V7)
in V10
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

