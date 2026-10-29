## (expr) (expression)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_28;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_31(env0, x1) {
  let __block = "entry";
  let match1;
  while (true) {
    switch (__block) {
      case "entry": {
        (__block = "sw2");
        break;
      }
      case "sw2": {
        const tag0 = x1.__tag;
        if ((String(tag0) === "some")) {
          (__block = "case4");
          break;
        }
      }
      case "case4": {
        const v5 = x1.payload;
        const v = v5;
        const __t0 = v;
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

function closure_30(env0, A1) {
  const env_cls2 = {};
  const fnref_cls2 = closure_31;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_29(env0, a1) {
  const env_cls2 = {};
  const fnref_cls2 = closure_30;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_28(env0, r1) {
  const env_cls2 = {};
  const fnref_cls2 = closure_29;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();

