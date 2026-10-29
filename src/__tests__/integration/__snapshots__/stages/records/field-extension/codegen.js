## point (let)
function main() {
  const v0 = 10;
  const v1 = {
    x: v0
  };
  return v1;
}
return main();


## point3d (let)
function main() {
  const v0 = 30;
  const v1 = 20;
  const v2 = point;
  const v3 = {
    ...v2,
    y: v1
  };
  const v4 = {
    ...v3,
    z: v0
  };
  return v4;
}
return main();


## updated (let)
function main() {
  const v0 = 100;
  const v1 = point;
  const v2 = {
    ...v1,
    x: v0
  };
  return v2;
}
return main();


## updatedX (let)
function main() {
  const v0 = updated;
  const v1 = v0.x;
  return v1;
}
return main();

