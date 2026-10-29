## block (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_19;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  const f3 = closure_cls2;
  const v4 = 1;
  const fnref5 = f3.__fn;
  const env6 = f3.__env;
  const v7 = fnref5(env6, v4);
  return v7;
}

function closure_19(env0, o1) {
  const v0 = 1;
  const v1 = (o1 + v0);
  return v1;
}
return main();

