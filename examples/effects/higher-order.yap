foreign Ask: Effect Unit Num;

let ask: (u: Unit [| \st u -> live st Ask |]) -> Num = \u -> capture [Ask] u;

let handled: (f: (u: Unit [| \st u -> live st Ask |]) -> Num) -> Num = \f -> with Ask: (\p k -> k 1) in f !;

let result = handled ask;
