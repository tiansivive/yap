{
  foreign E: Effect Num Num;
  let choose = \x -> match x
    | 0 -> capture [E] 20
    | _ -> capture [E] 30;
  return with E: (\p k -> k p) in
    10 + (choose 1);
}
