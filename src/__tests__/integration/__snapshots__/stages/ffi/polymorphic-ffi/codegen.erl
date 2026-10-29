## prepend (foreign)


## id (foreign)


## nums (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 'Num'
in let <V1> = 42
in let <V2> = 1
in let <V3> = 2
in let <V4> = 3
in let <V5> = call 'maps':'from_list'([{'0', V2}, {'1', V3}, {'2', V4}])
in let <V6> = apply Prepend(V0, V1, V5)
in V6
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## strs (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 'String'
in let <V1> = "a"
in let <V2> = "b"
in let <V3> = "c"
in let <V4> = call 'maps':'from_list'([{'0', V2}, {'1', V3}])
in let <V5> = apply Prepend(V0, V1, V4)
in V5
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

