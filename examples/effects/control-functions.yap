{
  foreign E: Effect ((Num -> Num) -> Num) Num;
  let control0 = \e => \f -> capture [e] f;
  let shift0 = \e => \f -> capture [e] (\k -> f (\v -> reset [e] (k v)));
  let control1 = \e => \f -> capture [e] (\k -> reset [e] (f k));
  let shift1 = \e => \f -> capture [e] (\k -> reset [e] (f (\v -> reset [e] (k v))));
  return reset [E] (10 + (shift0 @Num @Num @E (\k -> k 1)));
}
