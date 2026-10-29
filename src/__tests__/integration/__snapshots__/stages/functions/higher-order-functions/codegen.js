## compose (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_21;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_23(env0, x1) {
  const cap_0 = env0.v0;
  const cap_1 = env0.v1;
  const fnref0 = cap_1.__fn;
  const env1 = cap_1.__env;
  const v2 = fnref0(env1, x1);
  const fnref3 = cap_0.__fn;
  const env4 = cap_0.__env;
  const v5 = fnref3(env4, v2);
  return v5;
}

function closure_22(env0, g1) {
  const cap_0 = env0.v0;
  const env_cls2 = {
    v0: cap_0,
    v1: g1
  };
  const fnref_cls2 = closure_23;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_21(env0, f1) {
  const env_cls2 = {
    v0: f1
  };
  const fnref_cls2 = closure_22;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();


## add1 (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_13;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_13(env0, x1) {
  const v0 = 1;
  const v1 = (x1 + v0);
  return v1;
}
return main();


## add5 (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_13;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_13(env0, x1) {
  const v0 = 5;
  const v1 = (x1 + v0);
  return v1;
}
return main();


## double (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_13;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_13(env0, x1) {
  const v0 = 2;
  const v1 = (x1 * v0);
  return v1;
}
return main();


## add1ThenDouble (let)
function main() {
  const v0 = compose;
  const v1 = double;
  const fnref2 = v0.__fn;
  const env3 = v0.__env;
  const v4 = fnref2(env3, v1);
  const v5 = add1;
  const fnref6 = v4.__fn;
  const env7 = v4.__env;
  const v8 = fnref6(env7, v5);
  return v8;
}
return main();

