## negTestCheckLiteral (let)
function main() {
  const v0 = 2;
  return v0;
}
return main();


## negFnApp (let)
function main() {
  const v0 = 1;
  const v1 = 2;
  const v2 = (v0 + v1);
  return v2;
}
return main();


## negTestCheckLambdaPreAndPostCondition (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_8;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_8(env0, x1) {
  const v0 = 0;
  return v0;
}
return main();

