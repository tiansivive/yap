{
  foreign Fail: (a: Type) => Effect String a;
  let fail = \message -> capture [Fail] message;
  return with Fail: (\message k -> 0) in
    100 + (fail "missing input");
}
