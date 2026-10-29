## Peano (let)
function main() {
  const v0 = {};
  return v0;
}
return main();


## zero (let)
function main() {
  const v0 = "zero";
  const v1 = null;
  const v2 = {
    __tag: v0,
    payload: v1
  };
  return v2;
}
return main();


## first (let)
function main() {
  const v0 = "succ";
  const v1 = zero;
  const v2 = {
    __tag: v0,
    payload: v1
  };
  return v2;
}
return main();


## second (let)
function main() {
  const v0 = "succ";
  const v1 = first;
  const v2 = {
    __tag: v0,
    payload: v1
  };
  return v2;
}
return main();

