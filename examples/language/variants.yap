{
  let Reading: Type = | #value Num | #missing Unit;
  let valueOr: Num -> Reading -> Num = \fallback reading ->
    match reading
      | #value n -> n
      | #missing _ -> fallback;
  let present: Reading = #value 42;
  let absent: Reading = #missing !;
  return { present: valueOr 0 present, absent: valueOr 7 absent };
}
