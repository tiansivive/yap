## getX (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_19;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_20(env0, record1) {
  const v0 = record1.x;
  return v0;
}

function closure_19(env0, r1) {
  const env_cls2 = {};
  const fnref_cls2 = closure_20;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();


## p1 (let)
function main() {
  const v0 = getX;
  const v1 = "Num";
  const v2 = {
    y: v1
  };
  const fnref3 = v0.__fn;
  const env4 = v0.__env;
  const v5 = fnref3(env4, v2);
  const v6 = 10;
  const v7 = 20;
  const v8 = {
    x: v6,
    y: v7
  };
  const fnref9 = v5.__fn;
  const env10 = v5.__env;
  const v11 = fnref9(env10, v8);
  return v11;
}
return main();


## p2 (let)
function main() {
  const v0 = getX;
  const v1 = "Num";
  const v2 = "Num";
  const v3 = {
    y: v1,
    z: v2
  };
  const fnref4 = v0.__fn;
  const env5 = v0.__env;
  const v6 = fnref4(env5, v3);
  const v7 = 5;
  const v8 = 3;
  const v9 = 7;
  const v10 = {
    x: v7,
    y: v8,
    z: v9
  };
  const fnref11 = v6.__fn;
  const env12 = v6.__env;
  const v13 = fnref11(env12, v10);
  return v13;
}
return main();


## p3 (let)
function main() {
  const v0 = getX;
  const v1 = "String";
  const v2 = {
    name: v1
  };
  const fnref3 = v0.__fn;
  const env4 = v0.__env;
  const v5 = fnref3(env4, v2);
  const v6 = 100;
  const v7 = "point";
  const v8 = {
    x: v6,
    name: v7
  };
  const fnref9 = v5.__fn;
  const env10 = v5.__env;
  const v11 = fnref9(env10, v8);
  return v11;
}
return main();

