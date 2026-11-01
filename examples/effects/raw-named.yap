{
  foreign Prompt: Effect ((Num -> Num) -> Num) Num;
  return reset [Prompt] (10 + (capture [Prompt] (\k -> reset [Prompt] (k 2))));
}
