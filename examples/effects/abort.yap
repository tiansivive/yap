foreign Fail: (a: Type) => Effect String a;

let aborted = with Fail: (\message k -> 0) in 100 + (capture [Fail] "missing input");
