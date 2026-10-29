## (expr) (expression)
function main() {
  const v0 = 1;
  const v1 = 2;
  const v2 = {
    x: v0,
    y: v1
  };
  const v3 = v2.x;
  const v4 = 2;
  const v5 = (v3 / v4);
  const v6 = v2.y;
  const v7 = 2;
  const v8 = (v6 / v7);
  const v9 = {
    a: v5,
    b: v8
  };
  const v10 = {
    point: v2,
    halved: v9
  };
  return v10;
}
return main();

