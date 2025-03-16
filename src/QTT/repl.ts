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
import * as Mod from "./modules";

const empty: EB.Context = {
	env: [],
	types: [],
	names: [],
	trace: [],
	implicits: [],
	imports: Lib.Elaborated,
};

try {
	console.log("MODULES:");
	const res = Mod.mkInterface("main.yap");

	Object.entries(res).forEach(([k, v]) => {
		if (E.isLeft(v)) {
			console.log(Err.display(v.left));
			return;
		}

		const [tm, ty, us] = v.right;

		console.log(k + ":");
		console.log(NF.display(ty));
		console.log(EB.Display.Term(tm));
		console.log("\n");
	});
} catch (e) {
	console.error(e);
}
