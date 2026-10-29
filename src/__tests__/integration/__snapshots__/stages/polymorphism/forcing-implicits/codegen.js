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


## forcedStr (let)
function main() {
  const v0 = id;
  const v1 = String;
  const fnref2 = v0.__fn;
  const env3 = v0.__env;
  const v4 = fnref2(env3, v1);
  const v5 = "hello";
  const fnref6 = v4.__fn;
  const env7 = v4.__env;
  const v8 = fnref6(env7, v5);
  return v8;
}
return main();

