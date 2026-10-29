## rectangle (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 10
in let <V1> = 20
in let <V2> = call 'erlang':'*'(V0, V1)
in let <V3> = call 'maps':'from_list'([{'width', V0}, {'height', V1}, {'area', V2}])
in V3
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

