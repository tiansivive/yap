{
  let later = reset ((capture (\k -> \u -> resume u)) + (capture (\k -> 999)));
  return reset (100 + (later 5));
}
