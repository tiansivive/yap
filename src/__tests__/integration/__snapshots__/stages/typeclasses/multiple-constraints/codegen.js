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


## displayIfEqual (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_65;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_69(env0, y1) {
  let __block = "entry";
  let match7;
  while (true) {
    switch (__block) {
      case "entry": {
        const cap_0 = env0.v0;
        const cap_1 = env0.v1;
        const cap_2 = env0.v2;
        (__block = "sw8");
        break;
      }
      case "sw8": {
        const v0 = cap_0.eq;
        const fnref1 = v0.__fn;
        const env2 = v0.__env;
        const v3 = fnref1(env2, cap_1);
        const fnref4 = v3.__fn;
        const env5 = v3.__env;
        const v6 = fnref4(env5, y1);
        if ((String(v6) === "true")) {
          (__block = "case10");
          break;
        }
        if ((String(v6) === "false")) {
          (__block = "case11");
          break;
        }
      }
      case "case10": {
        const v11 = "Equal: ";
        const v12 = cap_2.show;
        const fnref13 = v12.__fn;
        const env14 = v12.__env;
        const v15 = fnref13(env14, cap_1);
        const v16 = (v11 + v15);
        const __t0 = v16;
        (match7 = __t0);
        (__block = "join9");
        break;
      }
      case "case11": {
        const v12 = "Not equal";
        const __t0 = v12;
        (match7 = __t0);
        (__block = "join9");
        break;
      }
      case "join9": {
        return match7;
      }
    }
  }
}

function closure_68(env0, x1) {
  const cap_0 = env0.v0;
  const cap_1 = env0.v1;
  const cap_2 = env0.v2;
  const env_cls2 = {
    v0: cap_1,
    v1: x1,
    v2: cap_2
  };
  const fnref_cls2 = closure_69;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_67(env0, eq1) {
  const cap_0 = env0.v0;
  const cap_1 = env0.v1;
  const env_cls2 = {
    v0: cap_0,
    v1: eq1,
    v2: cap_1
  };
  const fnref_cls2 = closure_68;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_66(env0, show1) {
  const cap_0 = env0.v0;
  const env_cls2 = {
    v0: cap_0,
    v1: show1
  };
  const fnref_cls2 = closure_67;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_65(env0, t1) {
  const env_cls2 = {
    v0: t1
  };
  const fnref_cls2 = closure_66;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();


## (using) (using)


## (using) (using)


## msg (let)
function main() {
  const v0 = displayIfEqual;
  const v1 = "Num";
  const fnref2 = v0.__fn;
  const env3 = v0.__env;
  const v4 = fnref2(env3, v1);
  const v5 = ShowNum;
  const fnref6 = v4.__fn;
  const env7 = v4.__env;
  const v8 = fnref6(env7, v5);
  const v9 = EqNum;
  const fnref10 = v8.__fn;
  const env11 = v8.__env;
  const v12 = fnref10(env11, v9);
  const v13 = 5;
  const fnref14 = v12.__fn;
  const env15 = v12.__env;
  const v16 = fnref14(env15, v13);
  const v17 = 5;
  const fnref18 = v16.__fn;
  const env19 = v16.__env;
  const v20 = fnref18(env19, v17);
  return v20;
}
return main();

