## (expr) (expression)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_43;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_48(env0, x1) {
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
        const v5 = 0;
        const __t0 = v5;
        (match1 = __t0);
        (__block = "join3");
        break;
      }
      case "case5": {
        const v6 = 1;
        const __t0 = v6;
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

function closure_47(env0, B1) {
  const cap_0 = env0.v0;
  const env_cls2 = {};
  const fnref_cls2 = closure_48;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_46(env0, b1) {
  const cap_0 = env0.v0;
  const env_cls2 = {
    v0: cap_0
  };
  const fnref_cls2 = closure_47;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_45(env0, r1) {
  const cap_0 = env0.v0;
  const env_cls2 = {
    v0: cap_0
  };
  const fnref_cls2 = closure_46;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_44(env0, A1) {
  const env_cls2 = {
    v0: A1
  };
  const fnref_cls2 = closure_45;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_43(env0, a1) {
  const env_cls2 = {};
  const fnref_cls2 = closure_44;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();

