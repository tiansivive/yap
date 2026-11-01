{
  foreign E: Effect ((Num -> Num) -> Num) Num;
  return reset [E] (1000 + (reset [E] ((capture [E] (\k -> 100 + (k 1))) +
    (capture [E] (\k -> 999))
  )));
}
