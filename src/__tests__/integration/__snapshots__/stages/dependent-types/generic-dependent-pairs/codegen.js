## Pair (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_26;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_27(env0, p1) {
  const cap_0 = env0.v0;
  const v0 = {};
  return v0;
}

function closure_26(env0, a1) {
  const env_cls2 = {
    v0: a1
  };
  const fnref_cls2 = closure_27;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();


## exampleP1 (let)
function main() {
  const v0 = 42;
  const v1 = "hello";
  const v2 = {
    fst: v0,
    snd: v1
  };
  return v2;
}
return main();


## exampleP2 (let)
function main() {
  const v0 = true;
  const v1 = 100;
  const v2 = {
    fst: v0,
    snd: v1
  };
  return v2;
}
return main();

