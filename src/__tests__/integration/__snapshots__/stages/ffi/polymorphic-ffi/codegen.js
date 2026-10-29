## prepend (foreign)


## id (foreign)


## nums (let)
function main() {
  const v0 = "Num";
  const v1 = 42;
  const v2 = 1;
  const v3 = 2;
  const v4 = 3;
  const v5 = {
    "0": v2,
    "1": v3,
    "2": v4
  };
  const v6 = prepend(v0, v1, v5);
  return v6;
}
return main();


## strs (let)
function main() {
  const v0 = "String";
  const v1 = "a";
  const v2 = "b";
  const v3 = "c";
  const v4 = {
    "0": v2,
    "1": v3
  };
  const v5 = prepend(v0, v1, v4);
  return v5;
}
return main();

