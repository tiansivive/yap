## List (let)
function main() {
  const v0 = {};
  return v0;
}
return main();


## Functor (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_31;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_31(env0, f1) {
  const v0 = {};
  return v0;
}
return main();


## mapList (let)
function main() {
  const env_cls2 = {
    v0: List,
    v1: mapList
  };
  const fnref_cls2 = closure_60;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_63(env0, list1) {
  let __block = "entry";
  let match1;
  while (true) {
    switch (__block) {
      case "entry": {
        const cap_0 = env0.v0;
        const cap_1 = env0.v1;
        const cap_2 = env0.v2;
        const cap_3 = env0.v3;
        (__block = "sw2");
        break;
      }
      case "sw2": {
        const tag0 = list1.__tag;
        if ((String(tag0) === "nil")) {
          (__block = "case4");
          break;
        }
        if ((String(tag0) === "cons")) {
          (__block = "case5");
          break;
        }
      }
      case "case4": {
        const v5 = "nil";
        const v6 = null;
        const v7 = {
          __tag: v5,
          payload: v6
        };
        const __t0 = v7;
        (match1 = __t0);
        (__block = "join3");
        break;
      }
      case "case5": {
        const v6 = list1.payload;
        const v7 = v6["0"];
        const x = v7;
        const v8 = v6["1"];
        const xs = v8;
        const v9 = "cons";
        const fnref10 = cap_0.__fn;
        const env11 = cap_0.__env;
        const v12 = fnref10(env11, x);
        const fnref13 = cap_1.__fn;
        const env14 = cap_1.__env;
        const v15 = fnref13(env14, cap_2);
        const fnref16 = v15.__fn;
        const env17 = v15.__env;
        const v18 = fnref16(env17, cap_3);
        const fnref19 = v18.__fn;
        const env20 = v18.__env;
        const v21 = fnref19(env20, cap_0);
        const fnref22 = v21.__fn;
        const env23 = v21.__env;
        const v24 = fnref22(env23, xs);
        const v25 = {
          "0": v12,
          "1": v24
        };
        const v26 = {
          __tag: v9,
          payload: v25
        };
        const __t0 = v26;
        (match1 = __t0);
        (__block = "join3");
        break;
      }
      case "join3": {
        return match1;
      }
    }
  }
}

function closure_62(env0, f1) {
  const cap_0 = env0.v0;
  const cap_1 = env0.v1;
  const cap_2 = env0.v2;
  const cap_3 = env0.v3;
  const env_cls2 = {
    v0: f1,
    v1: cap_2,
    v2: cap_1,
    v3: cap_3
  };
  const fnref_cls2 = closure_63;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_61(env0, b1) {
  const cap_0 = env0.v0;
  const cap_1 = env0.v1;
  const cap_2 = env0.v2;
  const env_cls2 = {
    v0: cap_1,
    v1: cap_0,
    v2: cap_2,
    v3: b1
  };
  const fnref_cls2 = closure_62;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_60(env0, a1) {
  const cap_0 = env0.v0;
  const cap_1 = env0.v1;
  const env_cls2 = {
    v0: a1,
    v1: cap_0,
    v2: cap_1
  };
  const fnref_cls2 = closure_61;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();


## ListFunctor (let)
function main() {
  const v0 = mapList;
  const v1 = {
    map: v0
  };
  return v1;
}
return main();

