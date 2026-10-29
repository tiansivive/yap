## Nat (let)
function main() {
  return v0;
}
return main();


## safe (let)
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

