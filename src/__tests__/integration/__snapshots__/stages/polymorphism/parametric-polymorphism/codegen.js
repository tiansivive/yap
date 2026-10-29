## id (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_10;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_11(env0, x1) {
  return x1;
}

function closure_10(env0, a1) {
  const env_cls2 = {};
  const fnref_cls2 = closure_11;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();


## const (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_16;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_19(env0, y1) {
  const cap_0 = env0.v0;
  return cap_0;
}

function closure_18(env0, x1) {
  const cap_0 = env0.v0;
  const env_cls2 = {
    v0: x1
  };
  const fnref_cls2 = closure_19;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_17(env0, b1) {
  const cap_0 = env0.v0;
  const env_cls2 = {
    v0: b1
  };
  const fnref_cls2 = closure_18;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_16(env0, a1) {
  const env_cls2 = {
    v0: a1
  };
  const fnref_cls2 = closure_17;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();

