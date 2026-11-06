foreign Ask: Effect Unit Num;
foreign Exn: Effect String Num;

let other = with Exn: (\e k -> 0) in capture [Ask] !;
