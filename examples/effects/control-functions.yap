{
  let control0 = \f -> capture f;
  let shift0 = \f -> capture (\k -> f (\v -> reset (k v)));
  let control1 = \f -> capture (\k -> reset (f k));
  let shift1 = \f -> capture (\k -> reset (f (\v -> reset (k v))));
  return reset (10 + (shift0 (\k -> k 1)));
}
