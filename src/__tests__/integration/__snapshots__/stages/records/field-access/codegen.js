## point (let)
function main() {
  const v0 = 10;
  const v1 = 20;
  const v2 = {
    x: v0,
    y: v1
  };
  return v2;
}
return main();


## xCoord (let)
function main() {
  const v0 = point;
  const v1 = v0.x;
  return v1;
}
return main();


## getX (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_20;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_20(env0, p1) {
  const v0 = p1.x;
  return v0;
}
return main();

