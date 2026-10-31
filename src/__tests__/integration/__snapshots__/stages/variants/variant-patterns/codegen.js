## Shape (let)
function main() {
  const v0 = {};
  const v1 = Num;
  const v2 = {
    "1": v1,
    "0": v1
  };
  const v3 = {
    point: v0,
    rectangle: v2,
    circle: v1
  };
  return v3;
}
return main();


## describeShape (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_43;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_43(env0, s1) {
  let __block = "entry";
  let match1;
  while (true) {
    switch (__block) {
      case "entry": {
        (__block = "sw2");
        break;
      }
      case "sw2": {
        const tag0 = s1.__tag;
        if ((String(tag0) === "circle")) {
          (__block = "case4");
          break;
        }
        if ((String(tag0) === "rectangle")) {
          (__block = "case5");
          break;
        }
        if ((String(tag0) === "point")) {
          (__block = "case6");
          break;
        }
      }
      case "case4": {
        const v5 = s1.payload;
        const r = v5;
        const v6 = "Circle with radius";
        const __t0 = v6;
        (match1 = __t0);
        (__block = "join3");
        break;
      }
      case "case5": {
        const v6 = s1.payload;
        const v7 = v6["0"];
        const w = v7;
        const v8 = v6["1"];
        const h = v8;
        const v9 = "Rectangle";
        const __t0 = v9;
        (match1 = __t0);
        (__block = "join3");
        break;
      }
      case "case6": {
        const v7 = s1.payload;
        const v8 = "Point at coordinates";
        const __t0 = v8;
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

