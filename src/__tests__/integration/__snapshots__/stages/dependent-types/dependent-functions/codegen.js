## makeType (let)
function main() {
  const env_cls2 = {
    v0: Num,
    v1: String
  };
  const fnref_cls2 = closure_19;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_19(env0, b1) {
  let __block = "entry";
  let match0;
  while (true) {
    switch (__block) {
      case "entry": {
        const cap_0 = env0.v0;
        const cap_1 = env0.v1;
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
        const __t0 = cap_0;
        (match0 = __t0);
        (__block = "join2");
        break;
      }
      case "case4": {
        const __t0 = cap_1;
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


## T1 (let)
function main() {
  const v0 = makeType;
  const v1 = true;
  const fnref2 = v0.__fn;
  const env3 = v0.__env;
  const v4 = fnref2(env3, v1);
  return v4;
}
return main();


## T2 (let)
function main() {
  const v0 = makeType;
  const v1 = false;
  const fnref2 = v0.__fn;
  const env3 = v0.__env;
  const v4 = fnref2(env3, v1);
  return v4;
}
return main();

