foreign Ask: Effect Unit Num;

let ask: (u: Unit [| \st u -> live st Ask |]) -> Num = \u -> capture [Ask] u;

let later: (u: Unit [| \st u -> live st Ask |]) -> Num = with Ask: (\p k -> k 1) in (\u -> ask u);

let escaped = later !;
