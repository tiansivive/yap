## checkNum (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_13;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_14(env0, x1) {
  return x1;
}

function closure_13(env0, p1) {
  const env_cls2 = {};
  const fnref_cls2 = closure_14;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();


## nat5 (let)
function main() {
  const v0 = checkNum;
  const env_cls3 = {};
  const fnref_cls3 = closure_18;
  const closure_cls3 = {
    __fn: fnref_cls3,
    __env: env_cls3
  };
  const fnref4 = v0.__fn;
  const env5 = v0.__env;
  const v6 = fnref4(env5, closure_cls3);
  const v7 = 5;
  const fnref8 = v6.__fn;
  const env9 = v6.__env;
  const v10 = fnref8(env9, v7);
  return v10;
}

function closure_18(env1, n2) {
  const v1 = 0;
  const v2 = (n2 >= v1);
  return v2;
}
return main();

