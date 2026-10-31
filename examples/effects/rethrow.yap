{
  foreign Fail: Effect Num Num;
  let fail = \code -> capture [Fail] code;
  return with Fail: (\code k -> code + 100) in
    with Fail: (\code k -> fail (code + 10)) in
      1000 + (fail 1);
}
