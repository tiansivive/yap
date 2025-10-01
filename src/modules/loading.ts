import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as Sub from "@yap/elaboration/unification/substitution";

import { Either } from "fp-ts/lib/Either";
import { Option } from "fp-ts/lib/Option";
import * as O from "fp-ts/lib/Option";
import * as R from "fp-ts/lib/Record";
import * as E from "fp-ts/lib/Either";
import * as F from "fp-ts/lib/function";

import fs from "fs";
import { resolve } from "path";
import Nearley from "nearley";
import Grammar from "@yap/src/grammar";
import * as A from "fp-ts/lib/Array";

import * as P from "@yap/elaboration/shared/provenance";

import { set, setProp, update } from "@yap/utils";
import { GlobalDefaults } from "../compile";
import { defaultContext } from "@yap/shared/lib/constants";

type ModuleName = string;
export const globalModules: Record<ModuleName, Interface> = {};

export type Interface = {
	imports: Record<string, Separated>;
	exports: string[];

	foreign: [string, Either<V2.Err, EB.AST>][];
	letdecs: [string, Either<V2.Err, EB.AST>][];
	errors: V2.Err[];
};

type Separated = [Array<[string, V2.Err]>, Array<[string, EB.AST]>];

export const mkInterface = (moduleName: ModuleName, visited: string[] = [], opts = GlobalDefaults): Interface => {
	if (globalModules[moduleName]) {
		return globalModules[moduleName];
	}

	if (visited.includes(moduleName)) {
		throw new Error("Circular dependency detected: " + visited.join(" -> ") + " -> " + moduleName);
	}

	const str = fs.readFileSync(resolve(process.cwd(), opts.baseUrl, moduleName), { encoding: "utf-8" });
	const parser = new Nearley.Parser(Nearley.Grammar.fromCompiled(Grammar));

	const data = parser.feed(str);
	if (data.results.length !== 1) {
		throw new Error("Failed to parse module: " + moduleName);
	}
	const mod: Src.Module = data.results[0];

	type Separated = [Array<[string, V2.Err]>, Array<[string, EB.AST]>];
	const importsPerFile = mod.imports.reduce(
		(record, stmt) => {
			const imports = F.pipe(
				resolveImports(stmt, mkInterface(stmt.filepath, [moduleName, ...visited])),
				A.reduce([[], []], (result: Separated, [k, either]) => {
					return F.pipe(
						either,
						E.fold(
							(e): typeof result => [result[0].concat([[k, e]]), result[1]],
							(v): typeof result => [result[0], result[1].concat([[k, v]])],
						),
					);
				}),
			);

			return set(record, stmt.filepath.replace(".yap", ""), imports);
		},
		{} as Record<string, Separated>,
	);

	const allImports = Object.values(importsPerFile).flatMap(([errs, defs]) => defs);
	const localModuleCtx: EB.Context = update(defaultContext, "imports", imports => ({ ...imports, ...R.fromEntries(allImports) }));

	const iface: Interface = F.pipe(EB.Mod.elaborate(mod, localModuleCtx), setProp("imports", importsPerFile));
	iface.errors.forEach(err => {
		V2.display(err, Sub.empty, {});
		console.error(P.display(err.provenance || [], { cap: 100 }, Sub.empty, {}));
	});

	iface.letdecs.forEach(([name, result]) => {
		if (E.isLeft(result)) {
			console.warn(`Error in module ${moduleName} for let ${name}: ${result.left}`);
			V2.display(result.left, Sub.empty, {});
			console.error(P.display(result.left.provenance || [], { cap: 100 }, Sub.empty, {}));
		}
	});

	globalModules[moduleName] = iface;
	return iface;
};

const resolveImports = (stmt: Src.Import, imported: Interface): [string, Either<EB.V2.Err, EB.AST>][] => {
	const defs = imported.letdecs.concat(imported.foreign);

	const publicVars = defs.filter(([id]) => imported.exports.includes(id));
	if (stmt.type === "*") {
		return publicVars.filter(([id]) => !stmt.hiding.includes(id));
	}

	if (stmt.type === "explicit") {
		return publicVars.filter(([id]) => stmt.names.includes(id));
	}

	if (stmt.type === "qualified") {
		return publicVars.filter(([id]) => !stmt.hiding.includes(id)).map(([id, ast]) => [`$${stmt.as}_${id}`, ast]);
	}

	return publicVars;
};
