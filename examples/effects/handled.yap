foreign Ask: Effect Unit Num;

let answer = with Ask: (\p k -> k 42) in capture [Ask] !;
