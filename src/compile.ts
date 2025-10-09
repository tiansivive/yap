import * as Mod from "./modules/loading";
import * as CG from "./Codegen/modules";

import fs from "fs";
import beautify from "js-beautify";

export type Options = {
	outDir: string;
	baseUrl: string;
};

export const GlobalDefaults: Options = {
	outDir: "./bin/",
	baseUrl: "./yap/",
};

export const compile = (file: string, options: Options) => {
	try {
		const _ = Mod.mkInterface(file, [], options);

		Object.entries(Mod.globalModules).forEach(([filepath, iface]) => {
			console.log("Loaded module: " + filepath);
			// const code = CG.codegen(iface, filepath);
			// const formatted = beautify.js(code, { indent_size: 2 });
			const FFIfile = filepath.replace(".yap", ".ffi.js");

			const path = options.baseUrl + FFIfile;
			if (fs.existsSync(path)) {
				fs.copyFileSync(path, options.outDir + FFIfile.split("/").pop());
			}

			// const outfile = filepath.replace(".yap", ".js");
			// console.log("Writing: " + outfile);
			// fs.writeFileSync(options.outDir + outfile.split("/").pop(), formatted);
			// console.log("Generated: " + outfile);
		});
	} catch (e) {
		console.error(e);
	}
};
