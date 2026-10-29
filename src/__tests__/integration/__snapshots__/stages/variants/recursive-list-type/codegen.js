## List (let)
function main() {
  const v0 = {};
  return v0;
}
return main();


## xs (let)
function main() {
  const v0 = "cons";
  const v1 = 1;
  const v2 = "cons";
  const v3 = 2;
  const v4 = "nil";
  const v5 = null;
  const v6 = {
    __tag: v4,
    payload: v5
  };
  const v7 = {
    head: v3,
    tail: v6
  };
  const v8 = {
    __tag: v2,
    payload: v7
  };
  const v9 = {
    head: v1,
    tail: v8
  };
  const v10 = {
    __tag: v0,
    payload: v9
  };
  return v10;
}
return main();

