## List (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = call 'maps':'from_list'([])
in V0
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## empty (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 'nil'
in let <V1> = 'nil'
in let <V2> = call 'maps':'from_list'([{'__tag', V0}, {'payload', V1}])
in V2
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## listOf1 (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 'cons'
in let <V1> = 1
in let <V2> = 'nil'
in let <V3> = 'nil'
in let <V4> = call 'maps':'from_list'([{'__tag', V2}, {'payload', V3}])
in let <V5> = call 'maps':'from_list'([{'0', V1}, {'1', V4}])
in let <V6> = call 'maps':'from_list'([{'__tag', V0}, {'payload', V5}])
in V6
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end


## listOf3 (let)
module 'yap_main' ['main'/0]
attributes []

'main'/0 = fun () ->
  let <_MainResult> = let <V0> = 'cons'
in let <V1> = 1
in let <V2> = 'cons'
in let <V3> = 2
in let <V4> = 'cons'
in let <V5> = 3
in let <V6> = 'nil'
in let <V7> = 'nil'
in let <V8> = call 'maps':'from_list'([{'__tag', V6}, {'payload', V7}])
in let <V9> = call 'maps':'from_list'([{'0', V5}, {'1', V8}])
in let <V10> = call 'maps':'from_list'([{'__tag', V4}, {'payload', V9}])
in let <V11> = call 'maps':'from_list'([{'0', V3}, {'1', V10}])
in let <V12> = call 'maps':'from_list'([{'__tag', V2}, {'payload', V11}])
in let <V13> = call 'maps':'from_list'([{'0', V1}, {'1', V12}])
in let <V14> = call 'maps':'from_list'([{'__tag', V0}, {'payload', V13}])
in V14
  in let <_Print> = call 'io':'format'("~p~n", [_MainResult])
  in 'ok'
end

