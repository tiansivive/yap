## abs (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_29;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_29(env0, n1) {
  let __block = "entry";
  let match2;
  while (true) {
    switch (__block) {
      case "entry": {
        (__block = "sw3");
        break;
      }
      case "sw3": {
        const v0 = 0;
        const v1 = (v0 <= n1);
        if ((String(v1) === "true")) {
          (__block = "case5");
          break;
        }
        if ((String(v1) === "false")) {
          (__block = "case6");
          break;
        }
      }
      case "case5": {
        const __t0 = n1;
        (match2 = __t0);
        (__block = "join4");
        break;
      }
      case "case6": {
        const v7 = 0;
        const v8 = (v7 - n1);
        const __t0 = v8;
        (match2 = __t0);
        (__block = "join4");
        break;
      }
      case "join4": {
        return match2;
      }
    }
  }
}
return main();


## absNegatesBoth (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_34;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_34(env0, n1) {
  let __block = "entry";
  let match2;
  while (true) {
    switch (__block) {
      case "entry": {
        (__block = "sw3");
        break;
      }
      case "sw3": {
        const v0 = 0;
        const v1 = (v0 <= n1);
        if ((String(v1) === "true")) {
          (__block = "case5");
          break;
        }
        if ((String(v1) === "false")) {
          (__block = "case6");
          break;
        }
      }
      case "case5": {
        const v6 = 0;
        const v7 = (v6 - n1);
        const __t0 = v7;
        (match2 = __t0);
        (__block = "join4");
        break;
      }
      case "case6": {
        const v7 = 0;
        const v8 = (v7 - n1);
        const __t0 = v8;
        (match2 = __t0);
        (__block = "join4");
        break;
      }
      case "join4": {
        return match2;
      }
    }
  }
}
return main();


## absKeepsBoth (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_23;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_23(env0, n1) {
  let __block = "entry";
  let match2;
  while (true) {
    switch (__block) {
      case "entry": {
        (__block = "sw3");
        break;
      }
      case "sw3": {
        const v0 = 0;
        const v1 = (v0 <= n1);
        if ((String(v1) === "true")) {
          (__block = "case5");
          break;
        }
        if ((String(v1) === "false")) {
          (__block = "case6");
          break;
        }
      }
      case "case5": {
        const __t0 = n1;
        (match2 = __t0);
        (__block = "join4");
        break;
      }
      case "case6": {
        const __t0 = n1;
        (match2 = __t0);
        (__block = "join4");
        break;
      }
      case "join4": {
        return match2;
      }
    }
  }
}
return main();

