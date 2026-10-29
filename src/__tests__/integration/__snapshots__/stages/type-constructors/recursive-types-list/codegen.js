## List (let)
function main() {
  const v0 = {};
  return v0;
}
return main();


## empty (let)
function main() {
  const v0 = "nil";
  const v1 = null;
  const v2 = {
    __tag: v0,
    payload: v1
  };
  return v2;
}
return main();


## listOf1 (let)
function main() {
  const v0 = "cons";
  const v1 = 1;
  const v2 = "nil";
  const v3 = null;
  const v4 = {
    __tag: v2,
    payload: v3
  };
  const v5 = {
    "0": v1,
    "1": v4
  };
  const v6 = {
    __tag: v0,
    payload: v5
  };
  return v6;
}
return main();


## listOf3 (let)
function main() {
  const v0 = "cons";
  const v1 = 1;
  const v2 = "cons";
  const v3 = 2;
  const v4 = "cons";
  const v5 = 3;
  const v6 = "nil";
  const v7 = null;
  const v8 = {
    __tag: v6,
    payload: v7
  };
  const v9 = {
    "0": v5,
    "1": v8
  };
  const v10 = {
    __tag: v4,
    payload: v9
  };
  const v11 = {
    "0": v3,
    "1": v10
  };
  const v12 = {
    __tag: v2,
    payload: v11
  };
  const v13 = {
    "0": v1,
    "1": v12
  };
  const v14 = {
    __tag: v0,
    payload: v13
  };
  return v14;
}
return main();

