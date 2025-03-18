import Grammar from "./parser/grammar";

import Nearley from "nearley";

import * as File from "../utils/files";

import * as Src from "@qtt/src/index";
import * as EB from "@qtt/elaboration";
import * as NF from "@qtt/elaboration/normalization";
import * as Lit from "@qtt/shared/literals";
import { mkLogger } from "@qtt/shared/logging";
import * as Log from "@qtt/shared/logging";

import * as Lib from "@qtt/shared/lib/primitives";

import * as E from "fp-ts/Either";
import { displayProvenance } from "./elaboration/solver";

import * as Err from "@qtt/elaboration/errors";

import * as F from "fp-ts/function";
import { M } from "@qtt/elaboration";
import * as Mod from "./modules/loading";
import * as CG from "./Codegen/modules";

import fs from "fs";

export const OUT_DIR = "./bin/";
export const BASE_URL = "./yap/";
try {
	const _ = Mod.mkInterface("main.yap");

	Object.entries(Mod.globalModules).forEach(([filepath, iface]) => {
		console.log("Loaded module: " + filepath);

		const FFIfile = filepath.replace(".yap", ".ffi.js");

		const path = BASE_URL + FFIfile;
		if (fs.existsSync(path)) {
			fs.copyFileSync(path, OUT_DIR + FFIfile.split("/").pop());
		}

		const code = CG.codegen(iface, filepath);

		const outfile = filepath.replace(".yap", ".js");
		fs.writeFileSync(OUT_DIR + outfile.split("/").pop(), code);
	});
} catch (e) {
	console.error(e);
}
