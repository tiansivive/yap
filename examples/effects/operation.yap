foreign Ask: Effect Unit Num;

let ask: (u: Unit [| \st u -> live st Ask |]) -> Num = \u -> capture [Ask] u;

let twice = with Ask: (\p k -> k 21) in (ask !) + (ask !);
