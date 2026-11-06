foreign Ask: Effect Unit Num;

let ask: (u: Unit [| \st u -> live st Ask |]) -> Num = \u -> capture [Ask] u;

let nearest = with Ask: (\p k -> k 10) in
    (ask !) + (with Ask: (\p k -> k 20) in ask !) + (ask !);
