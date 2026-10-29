## stringify (foreign)


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
    v0: mapList
  };
  const fnref_cls2 = closure_80;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_83(env0, list1) {
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

function closure_82(env0, f1) {
  const cap_0 = env0.v0;
  const cap_1 = env0.v1;
  const cap_2 = env0.v2;
  const env_cls2 = {
    v0: f1,
    v1: cap_1,
    v2: cap_0,
    v3: cap_2
  };
  const fnref_cls2 = closure_83;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_81(env0, b1) {
  const cap_0 = env0.v0;
  const cap_1 = env0.v1;
  const env_cls2 = {
    v0: cap_0,
    v1: cap_1,
    v2: b1
  };
  const fnref_cls2 = closure_82;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_80(env0, a1) {
  const cap_0 = env0.v0;
  const env_cls2 = {
    v0: a1,
    v1: cap_0
  };
  const fnref_cls2 = closure_81;
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


## fmap (let)
function main() {
  const env_cls2 = {
    v0: cap0
  };
  const fnref_cls2 = closure_56;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_58(env0, a1) {
  const cap_0 = env0.v0;
  const cap_1 = env0.v1;
  const cap_2 = env0.v2;
  return cap_0;
}

function closure_57(env0, functor1) {
  const cap_0 = env0.v0;
  const cap_1 = env0.v1;
  const env_cls2 = {
    v0: cap_0,
    v1: cap_1,
    v2: functor1
  };
  const fnref_cls2 = closure_58;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_56(env0, f1) {
  const cap_0 = env0.v0;
  const env_cls2 = {
    v0: cap_0,
    v1: f1
  };
  const fnref_cls2 = closure_57;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();


## (using) (using)


## strmap (let)
function main() {
  const env_cls2 = {
    v0: fmap
  };
  const fnref_cls2 = closure_53;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function pap_fn13(env14, arg15) {
  const cap_0 = env14.v0;
  const result_pap_fn13 = stringify(cap_0, arg15);
  return result_pap_fn13;
}

function closure_55(env0, A1) {
  const cap_0 = env0.v0;
  const cap_1 = env0.v1;
  const cap_2 = env0.v2;
  const fnref0 = cap_0.__fn;
  const env1 = cap_0.__env;
  const v2 = fnref0(env1, cap_1);
  const fnref3 = v2.__fn;
  const env4 = v2.__env;
  const v5 = fnref3(env4, A1);
  const fnref6 = v5.__fn;
  const env7 = v5.__env;
  const v8 = fnref6(env7, cap_2);
  const v9 = "String";
  const fnref10 = v8.__fn;
  const env11 = v8.__env;
  const v12 = fnref10(env11, v9);
  const env_cls13 = {
    v0: cap_2
  };
  const fnref_cls13 = pap_fn13;
  const closure_cls13 = {
    __fn: fnref_cls13,
    __env: env_cls13
  };
  const fnref14 = v12.__fn;
  const env15 = v12.__env;
  const v16 = fnref14(env15, closure_cls13);
  return v16;
}

function closure_54(env0, a1) {
  const cap_0 = env0.v0;
  const cap_1 = env0.v1;
  const env_cls2 = {
    v0: cap_1,
    v1: cap_0,
    v2: a1
  };
  const fnref_cls2 = closure_55;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_53(env0, F1) {
  const cap_0 = env0.v0;
  const env_cls2 = {
    v0: F1,
    v1: cap_0
  };
  const fnref_cls2 = closure_54;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();


## listOf1 (let)
function main() {
  const v0 = "cons";
  const v1 = 1;
  const v2 = "nil";
  const v3 = null;
  const v4 = {
    __tag: v2,
    payload: v3
  };
  const v5 = {
    "0": v1,
    "1": v4
  };
  const v6 = {
    __tag: v0,
    payload: v5
  };
  return v6;
}
return main();


## strList (let)
function main() {
  const v0 = strmap;
  const v1 = {};
  const fnref2 = v0.__fn;
  const env3 = v0.__env;
  const v4 = fnref2(env3, v1);
  const v5 = "Num";
  const fnref6 = v4.__fn;
  const env7 = v4.__env;
  const v8 = fnref6(env7, v5);
  const v9 = ListFunctor;
  const fnref10 = v8.__fn;
  const env11 = v8.__env;
  const v12 = fnref10(env11, v9);
  const v13 = listOf1;
  const fnref14 = v12.__fn;
  const env15 = v12.__env;
  const v16 = fnref14(env15, v13);
  return v16;
}
return main();

