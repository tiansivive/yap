{
  foreign Ask: Effect Unit Num;
  let ask = \u -> capture [Ask] u;
  return with Ask: (\p k -> k 21) in (ask !) + (ask !);
}
