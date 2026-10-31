{
  foreign Ask: Effect Unit Num;
  let ask = \u -> capture [Ask] u;
  return reset [Ask] (ask !);
}
