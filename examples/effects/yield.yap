foreign Yield: Effect Num Unit;

let yield: (x: Num [| \st v -> live st Yield |]) -> Unit = \x -> capture [Yield] x;

let total = with Yield: (\p k -> p + (k !)) in {
    yield 1;
    yield 2;
    return 0;
};
