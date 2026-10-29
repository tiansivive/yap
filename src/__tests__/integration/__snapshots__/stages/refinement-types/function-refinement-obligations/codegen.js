## fn (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_7;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_7(env0, x1) {
  const v0 = 2;
  return v0;
}
return main();


## posTestCheckLambdaPostCondition (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_7;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_7(env0, x1) {
  const v0 = 1;
  return v0;
}
return main();


## posTestCheckLambdaPreCondition (let)
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
  return x1;
}
return main();


## posTestCheckLambdaPreAndPostCondition (let)
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
  return x1;
}
return main();


## posTestCheckRefinedResultLambda (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_13;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_13(env0, x1) {
  const v0 = 1;
  const v1 = (x1 + v0);
  return v1;
}
return main();


## inc (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_13;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_13(env0, x1) {
  const v0 = 1;
  const v1 = (x1 + v0);
  return v1;
}
return main();

