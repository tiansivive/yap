## print (foreign)


## stringify (foreign)


## greet (let)
module 'yap_main' ['main'/0, 'closure_20'/2]
attributes []

'closure_20'/2 = fun (Env0, Name1) ->
  let <V0> = "Hello, "
  in let <V1> = call 'erlang':'++'(V0, Name1)
  in let <V2> = apply Print(V1)
  in let <V3> = 'nil'
  in V3

'main'/0 = fun () ->
  let <_MainResult> = let <Env_cls2> = call 'maps':'from_list'([])
in let <Fnref_cls2> = fun 'yap_main':'closure_20'/2
in let <Closure_cls2> = call 'maps':'from_list'([{'__fn', Fnref_cls2}, {'__env', Env_cls2}])
in Closure_cls2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

