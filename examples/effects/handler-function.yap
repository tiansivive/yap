{
  foreign Scale: Effect Num Num;
  let scale = \value -> capture [Scale] value;
  let multiplier = \factor payload k -> k (payload * factor);
  return with Scale: multiplier 2 in
    (scale 10) + (scale 11);
}
