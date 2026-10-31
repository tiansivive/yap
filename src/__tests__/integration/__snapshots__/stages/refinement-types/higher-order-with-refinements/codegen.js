## Nat (let)
function main() {
  return v0;
}
return main();


## Pos (let)
function main() {
  return v0;
}
return main();


## hof (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_12;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_12(env0, f1) {
  const v0 = 1;
  const fnref1 = f1.__fn;
  const env2 = f1.__env;
  const v3 = fnref1(env2, v0);
  return v3;
}
return main();


## hof2 (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_18;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_18(env0, f1) {
  const v0 = 1;
  const fnref1 = f1.__fn;
  const env2 = f1.__env;
  const v3 = fnref1(env2, v0);
  const v4 = 1;
  const v5 = (v3 + v4);
  return v5;
}
return main();

