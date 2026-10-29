## (expr) (expression)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_20;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  const proj3 = closure_cls2;
  const v4 = null;
  return v4;
}

function closure_22(env0, obj1) {
  const v0 = obj1.x;
  return v0;
}

function closure_21(env0, a1) {
  const env_cls2 = {};
  const fnref_cls2 = closure_22;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_20(env0, r1) {
  const env_cls2 = {};
  const fnref_cls2 = closure_21;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();

