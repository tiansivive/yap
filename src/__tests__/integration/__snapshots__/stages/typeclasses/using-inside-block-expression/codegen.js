## stringify (foreign)


## Show (let)
function main() {
  const env_cls2 = {
    v0: String
  };
  const fnref_cls2 = closure_18;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_18(env0, t1) {
  const cap_0 = env0.v0;
  const v0 = {};
  return v0;
}
return main();


## Eq (let)
function main() {
  const env_cls2 = {
    v0: Bool
  };
  const fnref_cls2 = closure_20;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_20(env0, t1) {
  const cap_0 = env0.v0;
  const v0 = {};
  return v0;
}
return main();


## ShowNum (let)
function main() {
  const v0 = "Num";
  const env_cls1 = {
    v0: v0
  };
  const fnref_cls1 = pap_fn1;
  const closure_cls1 = {
    __fn: fnref_cls1,
    __env: env_cls1
  };
  const v2 = {
    show: closure_cls1
  };
  return v2;
}

function pap_fn1(env2, arg3) {
  const cap_0 = env2.v0;
  const result_pap_fn1 = stringify(cap_0, arg3);
  return result_pap_fn1;
}
return main();


## EqNum (let)
function main() {
  const v0 = unknown;
  const v1 = {
    eq: v0
  };
  return v1;
}
return main();


## areEqual (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_31;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_32(env0, eq1) {
  const cap_0 = env0.v0;
  const v0 = eq1.eq;
  return v0;
}

function closure_31(env0, t1) {
  const env_cls2 = {
    v0: t1
  };
  const fnref_cls2 = closure_32;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();


## result (let)
function main() {
  const v0 = EqNum;
  const v1 = areEqual;
  const v2 = "Num";
  const fnref3 = v1.__fn;
  const env4 = v1.__env;
  const v5 = fnref3(env4, v2);
  const fnref6 = v5.__fn;
  const env7 = v5.__env;
  const v8 = fnref6(env7, v0);
  const v9 = 10;
  const fnref10 = v8.__fn;
  const env11 = v8.__env;
  const v12 = fnref10(env11, v9);
  const v13 = 10;
  const fnref14 = v12.__fn;
  const env15 = v12.__env;
  const v16 = fnref14(env15, v13);
  const same17 = v16;
  return same17;
}
return main();

