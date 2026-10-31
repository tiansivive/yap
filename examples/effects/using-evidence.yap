{
  foreign Ask: Effect Unit Num;
  let ask = \u -> capture [Ask] u;
  let run = \(capabilities: { Ask: Ask }) -> \u -> {
    using capabilities;
    return (ask !) + (ask !);
  };
  return with Ask: (\p k -> k 21) in
    run { Ask: Ask } !;
}
