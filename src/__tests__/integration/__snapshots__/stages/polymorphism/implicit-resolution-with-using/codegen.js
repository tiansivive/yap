## addImplicit (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_16;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_17(env0, x1) {
  const cap_0 = env0.v0;
  const v0 = (x1 + cap_0);
  return v0;
}

function closure_16(env0, n1) {
  const env_cls2 = {
    v0: n1
  };
  const fnref_cls2 = closure_17;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();


## (using) (using)


## eleven (let)
function main() {
  const v0 = addImplicit;
  const v1 = 10;
  const fnref2 = v0.__fn;
  const env3 = v0.__env;
  const v4 = fnref2(env3, v1);
  const v5 = 1;
  const fnref6 = v4.__fn;
  const env7 = v4.__env;
  const v8 = fnref6(env7, v5);
  return v8;
}
return main();


## fifteen (let)
function main() {
  const v0 = addImplicit;
  const v1 = 10;
  const fnref2 = v0.__fn;
  const env3 = v0.__env;
  const v4 = fnref2(env3, v1);
  const v5 = 5;
  const fnref6 = v4.__fn;
  const env7 = v4.__env;
  const v8 = fnref6(env7, v5);
  return v8;
}
return main();

