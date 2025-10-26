import "../chunk-ZD7AOCMD.mjs";
import { entries } from "@yap/utils";
import * as E from "fp-ts/lib/Either";
import * as CG from "./terms";
const codegen = (module, filepath) => {
  const imports = entries(module.imports).reduce((code, [filepath2, [errs, values]]) => {
    const info = errs.map(([name, err]) => `
// Error importing ${name}: ${err.type}`);
    const vars = values.map(([name]) => name).join(", ");
    const stmt = `
const { ${vars} } = require("./${filepath2}.js");`;
    return code + stmt + info;
  }, "");
  const foreign = module.foreign.reduce((code, [name, result]) => {
    const stmt = E.isLeft(result) ? `
// Error importing ${name}: ${result.left}` : `
const { ${name} } = require("./${filepath.replace(/\.yap$/, ".ffi.js")}");`;
    return code + stmt;
  }, "");
  const letdecs = module.letdecs.reduce((code, [name, result]) => {
    const stmt = E.isLeft(result) ? `
// Error importing ${name}: ${result.left}` : `
let ${name} = ${CG.codegen([name], result.right[0])};`;
    return code + stmt;
  }, "");
  const exports = `
module.exports = { ${module.exports.join(", ")} };`;
  return imports + foreign + letdecs + exports;
};
export {
  codegen
};
//# sourceMappingURL=modules.mjs.map