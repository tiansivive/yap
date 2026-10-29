## orderedListTestFail (let)
function main() {
  const v0 = {};
  const List1 = v0;
  const v2 = "cons";
  const v3 = 2;
  const v4 = "cons";
  const v5 = 1;
  const v6 = "nil";
  const v7 = null;
  const v8 = {
    __tag: v6,
    payload: v7
  };
  const v9 = {
    head: v5,
    tail: v8
  };
  const v10 = {
    __tag: v4,
    payload: v9
  };
  const v11 = {
    head: v3,
    tail: v10
  };
  const v12 = {
    __tag: v2,
    payload: v11
  };
  const ol13 = v12;
  const v14 = 1;
  return v14;
}
return main();

