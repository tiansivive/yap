## print (foreign)


## stringify (foreign)


## greet (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_20;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_20(env0, name1) {
  const v0 = "Hello, ";
  const v1 = (v0 + name1);
  const v2 = print(v1);
  const v3 = null;
  return v3;
}
return main();

