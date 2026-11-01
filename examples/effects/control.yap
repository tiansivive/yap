{
  foreign E: Effect ((Num -> Num) -> Num) Num;
  let Control = {
    shift0: \(a: Type) (b: Type) (e: Effect ((a -> b) -> b) a) => \f -> capture [e] (\k -> f (\v -> reset [e] (k v))),
    control0: \(a: Type) (b: Type) (e: Effect ((a -> b) -> b) a) => \f -> capture [e] f,
    shift: \(a: Type) (b: Type) (e: Effect ((a -> b) -> b) a) => \f -> capture [e] (\k -> reset [e] (f (\v -> reset [e] (k v)))),
    control: \(a: Type) (b: Type) (e: Effect ((a -> b) -> b) a) => \f -> capture [e] (\k -> reset [e] (f k))
  };
  return reset [E] (10 + (Control.shift0 @Num @Num @E (\k -> k 1)));
}
