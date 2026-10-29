## letpoly (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_25;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  const innerID3 = closure_cls2;
  const v4 = "Num";
  const fnref5 = innerID3.__fn;
  const env6 = innerID3.__env;
  const v7 = fnref5(env6, v4);
  const v8 = 42;
  const fnref9 = v7.__fn;
  const env10 = v7.__env;
  const v11 = fnref9(env10, v8);
  const n12 = v11;
  const v13 = "String";
  const fnref14 = innerID3.__fn;
  const env15 = innerID3.__env;
  const v16 = fnref14(env15, v13);
  const v17 = "hi";
  const fnref18 = v16.__fn;
  const env19 = v16.__env;
  const v20 = fnref18(env19, v17);
  const s21 = v20;
  return n12;
}

function closure_26(env0, x1) {
  return x1;
}

function closure_25(env0, a1) {
  const env_cls2 = {};
  const fnref_cls2 = closure_26;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();

