export *;

let result = with E: (\p k -> k p) in 10 + (capture [E] 2);
