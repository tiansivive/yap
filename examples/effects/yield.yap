{
  foreign Yield: Effect Num Unit;
  let yield = \x -> capture [Yield] x;
  return with Yield: (\p k -> p + (k !)) in {
    yield 1;
    yield 2;
    return 0;
  };
}
