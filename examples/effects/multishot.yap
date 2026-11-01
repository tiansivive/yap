{
  foreign Choice: Effect Num Num;
  let choose = \first -> capture [Choice] first;
  return with Choice: (\first k -> (k first) + (k (first + 1))) in
    10 + (choose 1);
}
