## isZero (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_17;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_17(env0, n1) {
  let __block = "entry";
  let match0;
  while (true) {
    switch (__block) {
      case "entry": {
        (__block = "sw1");
        break;
      }
      case "sw1": {
        if ((String(n1) === "0")) {
          (__block = "case3");
          break;
        }
        (__block = "default4");
        break;
      }
      case "case3": {
        const v4 = true;
        const __t0 = v4;
        (match0 = __t0);
        (__block = "join2");
        break;
      }
      case "default4": {
        const v5 = false;
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

