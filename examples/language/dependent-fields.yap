{
  let Same: Type = { first: Num, second: &first };
  let same: Same = { first: 7, second: 7 };
  let next: { first: Num, second: Num[| \v -> v == (&first + 1) |] } =
    { first: 7, second: $first + 1 };
  return { same: same, next: next };
}
