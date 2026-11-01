{
  foreign E: Effect ((Num -> (Num -> Num)) -> (Num -> Num)) Num;
  let later = reset [E] {
    let x = capture [E] (\k -> \u -> (reset [E] (k u)) 0);
    let y = capture [E] (\k -> \u -> 999);
    return \u -> x + y;
  };
  return reset (100 + (later 5));
}
