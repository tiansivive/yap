{
  let Eq: Type -> Type = \a -> { equal: a -> a -> Bool };
  let numbers: Eq Num = { equal: \a b -> a == b };
  let same: (a: Type) => (eq: Eq a) => a -> a -> Bool =
    \x y -> eq.equal x y;
  using numbers;
  return { equal: same 21 21, different: same 21 42 };
}
