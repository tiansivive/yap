{
  foreign Ask: Effect Unit Num;
  let ask = \u -> capture [Ask] u;
  return with Ask: (\p k -> k 10) in
    (ask !) +
    (with Ask: (\p k -> k 20) in ask !) +
    (ask !);
}
