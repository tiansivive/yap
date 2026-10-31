{
  let Control = {
    shift0: \f -> capture (\k -> f (\v -> reset (k v))),
    control0: \f -> capture f,
    shift: \f -> capture (\k -> reset (f (\v -> reset (k v)))),
    control: \f -> capture (\k -> reset (f k))
  };
  return reset (10 + (Control.shift0 (\k -> k 1)));
}
