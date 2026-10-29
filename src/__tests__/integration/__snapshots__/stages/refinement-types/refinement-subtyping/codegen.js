## Nat (let)
function main() {
  return v0;
}
return main();


## Pos (let)
function main() {
  return v0;
}
return main();


## useNat (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_8;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_8(env0, n1) {
  return n1;
}
return main();


## p (let)
function main() {
  const v0 = 42;
  return v0;
}
return main();


## result (let)
function main() {
  const v0 = useNat;
  const v1 = p;
  const fnref2 = v0.__fn;
  const env3 = v0.__env;
  const v4 = fnref2(env3, v1);
  return v4;
}
return main();

