{
  let id = \x -> x;
  let compose = \f g x -> f (g x);
  let addOne = \x -> x + 1;
  let double = \x -> x * 2;
  let transform = compose double addOne;
  return {
    number: id (transform 20),
    text: id "hello",
    flag: id true
  };
}
