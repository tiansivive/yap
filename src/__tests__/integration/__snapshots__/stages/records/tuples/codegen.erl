## pair (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 42
in let <V1> = "answer"
in let <V2> = call 'maps':'from_list'([{'0', V0}, {'1', V1}])
in V2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## pairExplicit (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 42
in let <V1> = "answer"
in let <V2> = call 'maps':'from_list'([{'0', V0}, {'1', V1}])
in V2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

