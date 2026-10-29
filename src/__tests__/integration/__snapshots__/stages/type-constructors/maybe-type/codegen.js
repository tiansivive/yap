## Maybe (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_13;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_13(env0, a1) {
  const v0 = "Unit";
  const v1 = {
    just: a1,
    nothing: v0
  };
  return v1;
}
return main();


## maybeNum (let)
function main() {
  const v0 = "just";
  const v1 = 42;
  const v2 = {
    __tag: v0,
    payload: v1
  };
  return v2;
}
return main();


## maybeStr (let)
function main() {
  const v0 = "nothing";
  const v1 = null;
  const v2 = {
    __tag: v0,
    payload: v1
  };
  return v2;
}
return main();

