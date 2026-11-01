{
  foreign E: Effect Num Num;
  let f = \x -> 1 + (capture [E] x);
  let g = \y -> 2 * (f y);
  return with E: (\p k -> (k p) + (k (p + 1))) in
    10 + (g 3);
}
