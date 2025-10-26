import "./chunk-ZD7AOCMD.mjs";
import * as Mod from "./modules/loading";
import fs from "fs";
const GlobalDefaults = {
  outDir: "./bin/",
  baseUrl: "./yap/"
};
const compile = (file, options) => {
  try {
    const _ = Mod.mkInterface(file, [], options);
    Object.entries(Mod.globalModules).forEach(([filepath, iface]) => {
      console.log("Loaded module: " + filepath);
      const FFIfile = filepath.replace(".yap", ".ffi.js");
      const path = options.baseUrl + FFIfile;
      if (fs.existsSync(path)) {
        fs.copyFileSync(path, options.outDir + FFIfile.split("/").pop());
      }
    });
  } catch (e) {
    console.error(e);
  }
};
export {
  GlobalDefaults,
  compile
};
//# sourceMappingURL=compile.mjs.map