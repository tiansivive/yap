foreign Ask: Effect Unit Num;
foreign Scale: Effect Num Num;

let ask: (u: Unit [| \st u -> live st Ask |]) -> Num = \u -> capture [Ask] u;
let scale: (value: Num [| \st v -> live st Scale |]) -> Num = \value -> capture [Scale] value;

let scaled = with Ask: (\p k -> k 21), Scale: (\p k -> k (p * 2)) in scale (ask !);
