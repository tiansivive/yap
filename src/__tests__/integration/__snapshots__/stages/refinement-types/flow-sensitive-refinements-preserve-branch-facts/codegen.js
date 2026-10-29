## test (let)
function main() {
  let __block = "entry";
  let match4;
  while (true) {
    switch (__block) {
      case "entry": {
        const b9 = match4;
        const v10 = 1;
        (__block = "sw5");
        break;
      }
      case "sw5": {
        const v0 = 1;
        const a1 = v0;
        const v2 = 0;
        const v3 = (a1 > v2);
        if ((String(v3) === "true")) {
          (__block = "case7");
          break;
        }
        if ((String(v3) === "false")) {
          (__block = "case8");
          break;
        }
      }
      case "case7": {
        const __t0 = a1;
        (match4 = __t0);
        (__block = "join6");
        break;
      }
      case "case8": {
        const v9 = 42;
        const __t0 = v9;
        (match4 = __t0);
        (__block = "join6");
        break;
      }
      case "join6": {
        return match4;
      }
    }
  }
}
return main();

