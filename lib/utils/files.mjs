import "../chunk-ZD7AOCMD.mjs";
import { readFileSync } from "fs";
import { resolve } from "path";
function load(filePath) {
  return readFileSync(resolve(process.cwd(), filePath), "utf-8");
}
export {
  load
};
//# sourceMappingURL=files.mjs.map