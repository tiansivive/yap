export *;

foreign print: String -> Unit;
foreign stringify: (a: Type) => a -> String;

let run = \x:Unit -> {
    print "hello world";
};
