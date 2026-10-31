## stringify (foreign)


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


## fmap (let)
function main() {
  const env_cls2 = {
    v0: Functor,
    v1: cap1
  };
  const fnref_cls2 = closure_37;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_39(env0, a1) {
  const cap_0 = env0.v0;
  const cap_1 = env0.v1;
  const cap_2 = env0.v2;
  return cap_0;
}

function closure_38(env0, functor1) {
  const cap_0 = env0.v0;
  const cap_1 = env0.v1;
  const env_cls2 = {
    v0: cap_0,
    v1: cap_1,
    v2: functor1
  };
  const fnref_cls2 = closure_39;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_37(env0, f1) {
  const cap_0 = env0.v0;
  const cap_1 = env0.v1;
  const env_cls2 = {
    v0: cap_1,
    v1: f1
  };
  const fnref_cls2 = closure_38;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();


## Option (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_13;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_13(env0, a1) {
  const v0 = "Unit";
  const v1 = {
    none: v0,
    some: a1
  };
  return v1;
}
return main();


## mapOption (let)
function main() {
  const env_cls2 = {
    v0: Option
  };
  const fnref_cls2 = closure_43;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_46(env0, o1) {
  let __block = "entry";
  let match1;
  while (true) {
    switch (__block) {
      case "entry": {
        const cap_0 = env0.v0;
        (__block = "sw2");
        break;
      }
      case "sw2": {
        const tag0 = o1.__tag;
        if ((String(tag0) === "some")) {
          (__block = "case4");
          break;
        }
        if ((String(tag0) === "none")) {
          (__block = "case5");
          break;
        }
      }
      case "case4": {
        const v5 = o1.payload;
        const x = v5;
        const v6 = "some";
        const fnref7 = cap_0.__fn;
        const env8 = cap_0.__env;
        const v9 = fnref7(env8, x);
        const v10 = {
          __tag: v6,
          payload: v9
        };
        const __t0 = v10;
        (match1 = __t0);
        (__block = "join3");
        break;
      }
      case "case5": {
        const v6 = "none";
        const v7 = null;
        const v8 = {
          __tag: v6,
          payload: v7
        };
        const __t0 = v8;
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

function closure_45(env0, f1) {
  const cap_0 = env0.v0;
  const cap_1 = env0.v1;
  const env_cls2 = {
    v0: f1
  };
  const fnref_cls2 = closure_46;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_44(env0, b1) {
  const cap_0 = env0.v0;
  const cap_1 = env0.v1;
  const env_cls2 = {
    v0: cap_1,
    v1: cap_0
  };
  const fnref_cls2 = closure_45;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_43(env0, a1) {
  const cap_0 = env0.v0;
  const env_cls2 = {
    v0: a1,
    v1: cap_0
  };
  const fnref_cls2 = closure_44;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();


## OptionFunctor (let)
function main() {
  const v0 = mapOption;
  const v1 = {
    map: v0
  };
  return v1;
}
return main();


## (using) (using)


## x (let)
function main() {
  const v0 = "some";
  const v1 = 1;
  const v2 = {
    __tag: v0,
    payload: v1
  };
  return v2;
}
return main();


## y (let)
function main() {
  const v0 = fmap;
  const v1 = Option;
  const fnref2 = v0.__fn;
  const env3 = v0.__env;
  const v4 = fnref2(env3, v1);
  const v5 = OptionFunctor;
  const fnref6 = v4.__fn;
  const env7 = v4.__env;
  const v8 = fnref6(env7, v5);
  const v9 = "Num";
  const fnref10 = v8.__fn;
  const env11 = v8.__env;
  const v12 = fnref10(env11, v9);
  const v13 = "String";
  const fnref14 = v12.__fn;
  const env15 = v12.__env;
  const v16 = fnref14(env15, v13);
  const v17 = "Num";
  const env_cls18 = {
    v0: v17
  };
  const fnref_cls18 = pap_fn18;
  const closure_cls18 = {
    __fn: fnref_cls18,
    __env: env_cls18
  };
  const fnref19 = v16.__fn;
  const env20 = v16.__env;
  const v21 = fnref19(env20, closure_cls18);
  const v22 = x;
  const fnref23 = v21.__fn;
  const env24 = v21.__env;
  const v25 = fnref23(env24, v22);
  return v25;
}

function pap_fn18(env19, arg20) {
  const cap_0 = env19.v0;
  const result_pap_fn18 = stringify(cap_0, arg20);
  return result_pap_fn18;
}
return main();

