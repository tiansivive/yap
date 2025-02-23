import * as EB from "@qtt/elaboration";
import * as Src from "@qtt/src/index";

import * as M from "@qtt/elaboration/monad";

import { Either } from "fp-ts/lib/Either";
import { Option } from "fp-ts/lib/Option";
import * as O from "fp-ts/lib/Option";
import * as R from "fp-ts/lib/Record";
import * as E from "fp-ts/lib/Either";
import * as F from "fp-ts/lib/function";

import fs from "fs";
import { resolve } from "path";
import Nearley from "nearley";
import Grammar from "@qtt/src/grammar";
import * as A from "fp-ts/lib/Array";

type ModuleName = string;
const globalModules: Record<ModuleName, Interface> = {};

type Identifier = string;
type Interface = Record<Identifier, Either<M.Err, EB.AST>>;

export const mkInterface = (moduleName: ModuleName): Interface => {
	if (globalModules[moduleName]) {
		return globalModules[moduleName];
	}

	const str = fs.readFileSync(resolve(process.cwd(), moduleName), { encoding: "utf-8" });
	const parser = new Nearley.Parser(Nearley.Grammar.fromCompiled(Grammar));

	const data = parser.feed(str);
	if (data.results.length !== 1) {
		throw new Error("Failed to parse module: " + moduleName);
	}
	const module: Src.Script = data.results[0];

	const deps = module.imports.reduce(
		(acc, { filepath }) => {
			const pathName = filepath.replace(/\//, ".");
			const { left, right } = F.pipe(
				mkInterface(filepath),
				R.toEntries,
				//A.map(([k, v]) => F.pipe(v, E.bimap(e => [`${pathName}.${k}`, e] as const, ast => [`${pathName}.${k}`, ast] as const))),
				// TODO:FIXME: We need to resolve the fully qualified names here. Leaving it as is for now.
				A.map(([k, v]) =>
					F.pipe(
						v,
						E.bimap(
							(e): [string, M.Err] => [k, e],
							(ast): [string, EB.AST] => [k, ast],
						),
					),
				),
				A.separate,
			);
			const imports = right.reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {} as EB.Context["imports"]);
			return { errors: [...acc.errors, ...left], imports: { ...acc.imports, ...imports } };
		},
		{
			errors: [] as [string, M.Err][],
			imports: {} as EB.Context["imports"],
		},
	);

	const start: EB.Context = {
		env: [],
		types: [],
		names: [],
		trace: [],
		imports: deps.imports,
	};
	const { left, right } = F.pipe(EB.script(module, start), A.separate);

	const errs = left.reduce((acc, [k, e]) => ({ ...acc, [k]: E.left(e) }), {} as Interface);
	const vals = right.reduce((acc, stmt) => {
		if (stmt[0].type !== "Let") {
			return acc;
		}

		const ast: EB.AST = [stmt[0].value, stmt[1], stmt[2]];
		return { ...acc, [stmt[0].variable]: E.right(ast) };
	}, {} as Interface);

	const iface = { ...errs, ...vals };
	globalModules[moduleName] = iface;
	return iface;
};

// export const markResolved = (moduleName: ModuleName, id: Identifier, ast: Either<M.Err, EB.AST>): void => {
//     if (!globalModules[moduleName]) { throw new Error('Module not initialized: ' + moduleName) }
//     if (!globalModules[moduleName][id]) { throw new Error(`Identifier '${id}' not found in interface for module: ${moduleName}`) }
//     if (O.isSome(globalModules[moduleName][id])) { throw new Error(`Identifier '${id}' already resolved in module: ${moduleName}`) }

//     globalModules[moduleName][id] = O.some(ast)
// }
