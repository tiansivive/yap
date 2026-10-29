## (expr) (expression)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 1
in let <V1> = 2
in let <V2> = call 'maps':'from_list'([{'x', V0}, {'y', V1}])
in let <V3> = call 'maps':'get'('x', V2)
in let <V4> = 2
in let <V5> = call 'erlang':'div'(V3, V4)
in let <V6> = call 'maps':'get'('y', V2)
in let <V7> = 2
in let <V8> = call 'erlang':'div'(V6, V7)
in let <V9> = call 'maps':'from_list'([{'a', V5}, {'b', V8}])
in let <V10> = call 'maps':'from_list'([{'point', V2}, {'halved', V9}])
in V10
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

