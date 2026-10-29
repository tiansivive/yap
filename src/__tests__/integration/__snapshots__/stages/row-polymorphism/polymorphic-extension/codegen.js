## addZ (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_24;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_25(env0, rec1) {
  const v0 = 0;
  const v1 = {
    ...rec1,
    z: v0
  };
  return v1;
}

function closure_24(env0, r1) {
  const env_cls2 = {};
  const fnref_cls2 = closure_25;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();


## p1 (let)
function main() {
  const v0 = addZ;
  const v1 = {};
  const fnref2 = v0.__fn;
  const env3 = v0.__env;
  const v4 = fnref2(env3, v1);
  const v5 = 1;
  const v6 = 2;
  const v7 = {
    x: v5,
    y: v6
  };
  const fnref8 = v4.__fn;
  const env9 = v4.__env;
  const v10 = fnref8(env9, v7);
  return v10;
}
return main();


## p2 (let)
function main() {
  const v0 = addZ;
  const v1 = "String";
  const v2 = {
    color: v1
  };
  const fnref3 = v0.__fn;
  const env4 = v0.__env;
  const v5 = fnref3(env4, v2);
  const v6 = 5;
  const v7 = 10;
  const v8 = "red";
  const v9 = {
    x: v6,
    y: v7,
    color: v8
  };
  const fnref10 = v5.__fn;
  const env11 = v5.__env;
  const v12 = fnref10(env11, v9);
  return v12;
}
return main();

