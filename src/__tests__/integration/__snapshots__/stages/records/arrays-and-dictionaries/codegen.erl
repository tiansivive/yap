## array (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 1
in let <V1> = 2
in let <V2> = 3
in let <V3> = call 'maps':'from_list'([{'0', V0}, {'1', V1}, {'2', V2}])
in V3
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## dict (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 3
in let <V1> = 2
in let <V2> = 1
in let <V3> = call 'maps':'from_list'([{'three', V0}, {'two', V1}, {'one', V2}])
in V3
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

