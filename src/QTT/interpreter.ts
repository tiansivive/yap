import Nearley from "nearley";
import Grammar from "@qtt/src/grammar";

import * as Src from "@qtt/src/index";
import * as EB from "@qtt/elaboration";

import * as E from "fp-ts/lib/Either";

import * as CG from "./Codegen/terms";

import fs from "fs";
import vm from "vm";
import { resolve } from "path";

import * as Lib from "@qtt/shared/lib/primitives";

export const interpret = (code: string, ctx: EB.Context) => {
	const g = Grammar;
	g.ParserStart = "Script";
	const parser = new Nearley.Parser(Nearley.Grammar.fromCompiled(Grammar));

	const sanitized = code.trim().endsWith(";") ? code : `${code};`;
	const data = parser.feed(sanitized);
	if (data.results.length !== 1) {
		console.error("Failed to parse statement");

		fs.writeFileSync(resolve(process.cwd(), "./.logs/error.json"), JSON.stringify(data.results, null, 2));

		throw new Error("Error while parsing statement. Check error.json for more information");
	}

	const { script }: Src.Script = data.results[0];
	if (script.length !== 1) {
		throw new Error("Expected a single statement");
	}
	const [stmt] = script;

	return interpretStmt(stmt, ctx);
};

const letdecs: string[] = [];

const interpretStmt = (stmt: Src.Statement, ctx: EB.Context) => {
	if (stmt.type === "let") {
		const [name, result] = EB.Mod.letdec(stmt, ctx);

		if (E.isLeft(result)) {
			console.error(`Error interpreting ${name}: ${result.left}`);
			return ctx;
		}

		const [[tm, ty, us], ctx_] = result.right;

		const code = `let ${name} = ${CG.codegen([name], tm)};`;
		letdecs.push(code);
		console.log(`:: ${EB.NF.display(ty)}`);
		return ctx_;
	}

	if (stmt.type === "expression") {
		const result = EB.Mod.expression(stmt, ctx);

		if (E.isLeft(result)) {
			console.error(`Error interpreting expression: ${result.left}`);
			return ctx;
		}

		const [tm, ty, us] = result.right;
		const code = CG.codegen([], tm);

		const script = letdecs.join("\n") + `\n${code}`;
		//console.log(script);

		const imported = Object.keys(ctx.imports).reduce((acc, key) => {
			return { ...acc, [key]: key };
		}, {});
		const vmCtx = vm.createContext({ ...imported, ...Lib.FFI });
		const res = vm.runInContext(script, vmCtx);

		console.dir(res, { showHidden: true, depth: null });
		// console.dir(Object.getOwnPropertyDescriptors(res), { showHidden: true, depth: null });
		console.log(`:: ${EB.NF.display(ty)}`);
		return ctx;
	}

	throw new Error("Unsupported statement");
};
