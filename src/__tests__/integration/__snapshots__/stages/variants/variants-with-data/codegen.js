## Shape (let)
function main() {
  const v0 = {};
  const v1 = Num;
  const v2 = {
    "1": v1,
    "0": v1
  };
  const v3 = {
    point: v0,
    rectangle: v2,
    circle: v1
  };
  return v3;
}
return main();


## c (let)
function main() {
  const v0 = "circle";
  const v1 = 5;
  const v2 = {
    __tag: v0,
    payload: v1
  };
  return v2;
}
return main();


## r (let)
function main() {
  const v0 = "rectangle";
  const v1 = 10;
  const v2 = 20;
  const v3 = {
    "0": v1,
    "1": v2
  };
  const v4 = {
    __tag: v0,
    payload: v3
  };
  return v4;
}
return main();


## p (let)
function main() {
  const v0 = "point";
  const v1 = 0;
  const v2 = 0;
  const v3 = {
    x: v1,
    y: v2
  };
  const v4 = {
    __tag: v0,
    payload: v3
  };
  return v4;
}
return main();

