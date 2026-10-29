## getName (let)
function main() {
  const env_cls2 = {};
  const fnref_cls2 = closure_19;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}

function closure_20(env0, obj1) {
  const v0 = obj1.name;
  return v0;
}

function closure_19(env0, r1) {
  const env_cls2 = {};
  const fnref_cls2 = closure_20;
  const closure_cls2 = {
    __fn: fnref_cls2,
    __env: env_cls2
  };
  return closure_cls2;
}
return main();


## person (let)
function main() {
  const v0 = "Alice";
  const v1 = 30;
  const v2 = {
    name: v0,
    age: v1
  };
  return v2;
}
return main();


## book (let)
function main() {
  const v0 = "1984";
  const v1 = "Orwell";
  const v2 = 328;
  const v3 = {
    name: v0,
    author: v1,
    pages: v2
  };
  return v3;
}
return main();


## n1 (let)
function main() {
  const v0 = getName;
  const v1 = "Num";
  const v2 = {
    age: v1
  };
  const fnref3 = v0.__fn;
  const env4 = v0.__env;
  const v5 = fnref3(env4, v2);
  const v6 = person;
  const fnref7 = v5.__fn;
  const env8 = v5.__env;
  const v9 = fnref7(env8, v6);
  return v9;
}
return main();


## n2 (let)
function main() {
  const v0 = getName;
  const v1 = "String";
  const v2 = "Num";
  const v3 = {
    author: v1,
    pages: v2
  };
  const fnref4 = v0.__fn;
  const env5 = v0.__env;
  const v6 = fnref4(env5, v3);
  const v7 = book;
  const fnref8 = v6.__fn;
  const env9 = v6.__env;
  const v10 = fnref8(env9, v7);
  return v10;
}
return main();

