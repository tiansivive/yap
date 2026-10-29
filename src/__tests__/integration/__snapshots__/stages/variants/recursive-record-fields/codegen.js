## Factorial (let)
function main() {
  const v0 = {};
  return v0;
}
return main();


## fact (let)
function main() {
  const v0 = {};
  const env_cls3 = {
    v0: v0
  };
  const fnref_cls3 = closure_33;
  const closure_cls3 = {
    __fn: fnref_cls3,
    __env: env_cls3
  };
  (v0.compute = closure_cls3);
  return v0;
}

function closure_33(env1, n2) {
  let __block = "entry";
  let match1;
  while (true) {
    switch (__block) {
      case "entry": {
        const cap_0 = env1.v0;
        (__block = "sw2");
        break;
      }
      case "sw2": {
        if ((String(n2) === "0")) {
          (__block = "case4");
          break;
        }
        (__block = "default5");
        break;
      }
      case "case4": {
        const v5 = 1;
        const __t0 = v5;
        (match1 = __t0);
        (__block = "join3");
        break;
      }
      case "default5": {
        const v6 = cap_0.compute;
        const v7 = 1;
        const v8 = (n2 - v7);
        const fnref9 = v6.__fn;
        const env10 = v6.__env;
        const v11 = fnref9(env10, v8);
        const v12 = (n2 * v11);
        const __t0 = v12;
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
return main();


## result (let)
function main() {
  const v0 = fact;
  const v1 = v0.compute;
  const v2 = 5;
  const fnref3 = v1.__fn;
  const env4 = v1.__env;
  const v5 = fnref3(env4, v2);
  return v5;
}
return main();

