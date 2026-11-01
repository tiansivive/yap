{
  foreign Ask: Effect Unit Num;
  let ask = \(capabilities: { Ask: Ask }) -> \u ->
    capture [capabilities.Ask] u;
  return with Ask: (\p k -> k 21) in
    (ask { Ask: Ask } !) + (ask { Ask: Ask } !);
}
