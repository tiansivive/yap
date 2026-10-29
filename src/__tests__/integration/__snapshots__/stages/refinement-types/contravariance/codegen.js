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


## takePosFunction (let)
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
  const v0 = 10;
  const fnref1 = f1.__fn;
  const env2 = f1.__env;
  const v3 = fnref1(env2, v0);
  return v3;
}
return main();


## natToNum (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_8;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_8(env0, x1) {
  return x1;
}
return main();


## posToNum (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_8;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_8(env0, x1) {
  return x1;
}
return main();


## result1 (let)
function main() {
  const v0 = takePosFunction;
  const v1 = natToNum;
  const fnref2 = v0.__fn;
  const env3 = v0.__env;
  const v4 = fnref2(env3, v1);
  return v4;
}
return main();


## result2 (let)
function main() {
  const v0 = takePosFunction;
  const v1 = posToNum;
  const fnref2 = v0.__fn;
  const env3 = v0.__env;
  const v4 = fnref2(env3, v1);
  return v4;
}
return main();

