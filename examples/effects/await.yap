{
  foreign Await: (a: Type) => Effect (Unit -> a) a;
  let await = \p -> capture [Await] p;
  return with Await: (\p k -> k (p !)) in
    (await (\u -> 20)) + (await (\u -> 22));
}
