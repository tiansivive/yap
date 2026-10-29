## Vec (let)
function main() {
  const v0 = {};
  return v0;
}
return main();


## vec0 (let)
function main() {
  const v0 = null;
  return v0;
}
return main();


## vec1 (let)
function main() {
  const v0 = 10;
  const v1 = vec0;
  const v2 = {
    "0": v0,
    "1": v1
  };
  return v2;
}
return main();


## vec2 (let)
function main() {
  const v0 = 20;
  const v1 = vec1;
  const v2 = {
    "0": v0,
    "1": v1
  };
  return v2;
}
return main();


## vec3 (let)
function main() {
  const v0 = 30;
  const v1 = vec2;
  const v2 = {
    "0": v0,
    "1": v1
  };
  return v2;
}
return main();

