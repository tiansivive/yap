{
  let later = reset ((capture (\k -> \u -> reset (k u))) + (capture (\k -> 999)));
  return reset (100 + (later 5));
}
