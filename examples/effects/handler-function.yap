foreign Scale: Effect Num Num;

let scale: (value: Num [| \st v -> live st Scale |]) -> Num = \value -> capture [Scale] value;
let multiplier: Num -> Num -> (Num -> Num) -> Num = \factor payload k -> k (payload * factor);

let doubled: Num = with Scale: multiplier 2 in (scale 10) + (scale 11);
