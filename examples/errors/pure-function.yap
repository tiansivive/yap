{
  foreign Ask: Effect Unit Num;
  let ask: Unit -> Num = \u -> capture [Ask] u;
  return 0;
}
