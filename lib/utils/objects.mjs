import "../chunk-ZD7AOCMD.mjs";
import fp from "lodash/fp";
function update(...args) {
  if (args.length === 3) {
    const [obj, path2, updater2] = args;
    return fp.update(path2)(updater2)(obj);
  }
  const [path, updater] = args;
  return fp.update(path)(updater);
}
const entries = (obj) => Object.entries(obj);
function set(...args) {
  if (args.length === 3) {
    const [obj, path2, value2] = args;
    return fp.set(path2)(value2)(obj);
  }
  const [path, value] = args;
  return fp.set(path)(value);
}
function setProp(...args) {
  if (args.length === 3) {
    const [obj, path2, value2] = args;
    return fp.set(path2, value2)(obj);
  }
  const [path, value] = args;
  return (obj) => fp.set(path, value)(obj);
}
export {
  entries,
  set,
  setProp,
  update
};
//# sourceMappingURL=objects.mjs.map