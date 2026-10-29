## test (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_38;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  const Pair3 = closure_cls2;
  const v4 = 1;
  const v5 = 2;
  const v6 = {
    fst: v4,
    snd: v5
  };
  const p7 = v6;
  const v8 = null;
  return v8;
}

function closure_40(env0, p1) {
  const cap_0 = env0.v0;
  const cap_1 = env0.v1;
  const v0 = {};
  return v0;
}

function closure_39(env0, b1) {
  const cap_0 = env0.v0;
  const env_cls2 = {
    v0: cap_0,
    v1: b1
  };
  const fnref_cls2 = closure_40;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_38(env0, a1) {
  const env_cls2 = {
    v0: a1
  };
  const fnref_cls2 = closure_39;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();

