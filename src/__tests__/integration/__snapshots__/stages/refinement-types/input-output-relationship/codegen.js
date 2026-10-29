## inc (let)
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

