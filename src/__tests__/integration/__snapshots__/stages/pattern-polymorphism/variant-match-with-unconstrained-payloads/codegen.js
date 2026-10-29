## (expr) (expression)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_64;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_72(env0, x1) {
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
        const v5 = x1.payload;
        const a = v5;
        const v6 = 0;
        const __t0 = v6;
        (match1 = __t0);
        (__block = "join3");
        break;
      }
      case "case5": {
        const v6 = x1.payload;
        const v7 = v6["0"];
        const el = v7;
        const v8 = v6["1"];
        const rest = v8;
        const v9 = 1;
        const __t0 = v9;
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

function closure_71(env0, C1) {
  const cap_0 = env0.v0;
  const env_cls2 = {};
  const fnref_cls2 = closure_72;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_70(env0, c1) {
  const cap_0 = env0.v0;
  const env_cls2 = {
    v0: cap_0
  };
  const fnref_cls2 = closure_71;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_69(env0, B1) {
  const cap_0 = env0.v0;
  const env_cls2 = {
    v0: cap_0
  };
  const fnref_cls2 = closure_70;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_68(env0, b1) {
  const cap_0 = env0.v0;
  const env_cls2 = {
    v0: cap_0
  };
  const fnref_cls2 = closure_69;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_67(env0, s1) {
  const cap_0 = env0.v0;
  const env_cls2 = {
    v0: cap_0
  };
  const fnref_cls2 = closure_68;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_66(env0, r1) {
  const cap_0 = env0.v0;
  const env_cls2 = {
    v0: cap_0
  };
  const fnref_cls2 = closure_67;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_65(env0, A1) {
  const env_cls2 = {
    v0: A1
  };
  const fnref_cls2 = closure_66;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_64(env0, a1) {
  const env_cls2 = {};
  const fnref_cls2 = closure_65;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();

