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


## ShowBool (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_19;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  const v3 = {
    show: closure_cls2
  };
  return v3;
}

function closure_19(env0, b1) {
  let __block = "entry";
  let match0;
  while (true) {
    switch (__block) {
      case "entry": {
        (__block = "sw1");
        break;
      }
      case "sw1": {
        if ((String(b1) === "true")) {
          (__block = "case3");
          break;
        }
        if ((String(b1) === "false")) {
          (__block = "case4");
          break;
        }
      }
      case "case3": {
        const v4 = "true";
        const __t0 = v4;
        (match0 = __t0);
        (__block = "join2");
        break;
      }
      case "case4": {
        const v5 = "false";
        const __t0 = v5;
        (match0 = __t0);
        (__block = "join2");
        break;
      }
      case "join2": {
        return match0;
      }
    }
  }
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

