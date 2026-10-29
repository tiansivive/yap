## compute (let)
function main() {
  const env_cls2 = {
    v0: doubled,
    v1: added
  };
  const fnref_cls2 = closure_24;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_24(env0, x1) {
  const cap_0 = env0.v0;
  const cap_1 = env0.v1;
  const v0 = 2;
  const v1 = (x1 * v0);
  const doubled2 = v1;
  const v3 = 10;
  const v4 = (doubled2 + v3);
  const added5 = v4;
  return added5;
}
return main();

