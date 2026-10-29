## identity (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_7;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_7(env0, x1) {
  return x1;
}
return main();


## add (let)
function main() {
  const v0 = unknown;
  return v0;
}
return main();


## forty2 (let)
function main() {
  const v0 = identity;
  const v1 = 42;
  const fnref2 = v0.__fn;
  const env3 = v0.__env;
  const v4 = fnref2(env3, v1);
  return v4;
}
return main();


## added (let)
function main() {
  const v0 = add;
  const v1 = 10;
  const fnref2 = v0.__fn;
  const env3 = v0.__env;
  const v4 = fnref2(env3, v1);
  const v5 = 20;
  const fnref6 = v4.__fn;
  const env7 = v4.__env;
  const v8 = fnref6(env7, v5);
  return v8;
}
return main();

