{
  let factorial: Num -> Num = \n ->
    match n
      | 0 -> 1
      | _ -> n * (factorial (n - 1));
  let sumTo = \n acc ->
    match n
      | 0 -> acc
      | _ -> sumTo (n - 1) (acc + n);
  return { factorial: factorial 5, sum: sumTo 10 0 };
}
