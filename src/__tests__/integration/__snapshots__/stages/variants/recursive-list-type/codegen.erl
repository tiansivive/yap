## List (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = call 'maps':'from_list'([])
in V0
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## xs (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 'cons'
in let <V1> = 1
in let <V2> = 'cons'
in let <V3> = 2
in let <V4> = 'nil'
in let <V5> = 'nil'
in let <V6> = call 'maps':'from_list'([{'__tag', V4}, {'payload', V5}])
in let <V7> = call 'maps':'from_list'([{'head', V3}, {'tail', V6}])
in let <V8> = call 'maps':'from_list'([{'__tag', V2}, {'payload', V7}])
in let <V9> = call 'maps':'from_list'([{'head', V1}, {'tail', V8}])
in let <V10> = call 'maps':'from_list'([{'__tag', V0}, {'payload', V9}])
in V10
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

