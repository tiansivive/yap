## List (let)
function main() {
  const v0 = {};
  return v0;
}
return main();


## length (let)
function main() {
  const env_cls2 = {
    v0: List,
    v1: length
  };
  const fnref_cls2 = closure_45;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_46(env0, list1) {
  let __block = "entry";
  let match1;
  while (true) {
    switch (__block) {
      case "entry": {
        const cap_0 = env0.v0;
        const cap_1 = env0.v1;
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
        const v5 = 0;
        const __t0 = v5;
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
        const v9 = 1;
        const fnref10 = cap_0.__fn;
        const env11 = cap_0.__env;
        const v12 = fnref10(env11, cap_1);
        const fnref13 = v12.__fn;
        const env14 = v12.__env;
        const v15 = fnref13(env14, xs);
        const v16 = (v9 + v15);
        const __t0 = v16;
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

function closure_45(env0, a1) {
  const cap_0 = env0.v0;
  const cap_1 = env0.v1;
  const env_cls2 = {
    v0: cap_1,
    v1: a1
  };
  const fnref_cls2 = closure_46;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();

