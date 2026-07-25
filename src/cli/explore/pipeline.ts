import Nearley from "nearley";
import Grammar from "@yap/src/grammar";

import * as Src from "@yap/src/index";
import * as EB from "@yap/elaboration";
import * as GRAM from "@yap/gram";

import * as E from "fp-ts/lib/Either";
import fs from "fs";
import { resolve } from "path";
import vm from "vm";

import { defaultContext } from "@yap/shared/lib/constants";
import * as Pipeline from "@yap/pipeline";
import * as MIR from "../../lowering/pretty";
import { emit as emitJS } from "../../Codegen/v2/js/emit";
import { print as printJS } from "../../Codegen/v2/js/print";
import { emit as emitC } from "../../Codegen/v2/c/emit";
import { print as printC } from "../../Codegen/v2/c/print";
import { emit as emitErl } from "../../Codegen/v2/erlang/emit";
import { print as printErl } from "../../Codegen/v2/erlang/print";
import * as Sub from "../../elaboration/unification/substitution";
import { VerificationServiceV2 } from "../../verification/V2/service";
import { Build } from "../../verification/solver/ivl/build";
import { Print as IVLPrint } from "../../verification/solver/ivl/print";
import { Solver } from "../../verification/solver/v2/solver";
import * as Replay from "../../verification/solver/v2/trace/replay";
import { Validity } from "../../verification/validity";

export type DeBruijnMode = "off" | "index" | "level" | "both";
export type ParserRule = "Ann" | "Script";

export type Options = {
	deBruijn: DeBruijnMode;
	parserRule: ParserRule;
	rawJson: boolean;
	ivlSimplify: boolean;
	evaluate: boolean;
	interpret: boolean;
};

export type Result = {
	source: string;
	parsed: string;
	elaborated: string;
	type: string;
	output: string;
	normalized: string;
	interpreted: string;
	constraints: string;
	metas: string;
	ivl: string;
	validity: string;
	solverTrace: string;
	mir: string;
	gram: string;
	gramDot: string;
	codegenJS: string;
	codegenC: string;
	codegenErlang: string;
	errors: string[];
	raw: Record<string, unknown>;
};

const empty: Result = {
	source: "",
	parsed: "",
	elaborated: "",
	type: "",
	output: "",
	normalized: "",
	interpreted: "",
	constraints: "",
	metas: "",
	ivl: "",
	validity: "",
	solverTrace: "",
	mir: "",
	gram: "",
	gramDot: "",
	codegenJS: "",
	codegenC: "",
	codegenErlang: "",
	errors: [],
	raw: {},
};

const deBruijnOpts = (mode: DeBruijnMode) => ({
	deBruijn: mode === "index" || mode === "level" || mode === "both",
});

const display = (value: unknown): string => {
	if (typeof value === "string") {
		return JSON.stringify(value);
	}
	if (typeof value === "object" && value instanceof Object) {
		return JSON.stringify(value);
	}
	return String(value);
};

const executeJS = (code: string): unknown => vm.runInNewContext(`(function () {\n${code}\n})()`);

const parse = (source: string, rule: ParserRule): Src.Term | Src.Statement => {
	Grammar.ParserStart = rule;
	const parser = new Nearley.Parser(Nearley.Grammar.fromCompiled(Grammar));

	const sanitized = rule === "Script" ? (source.trim().endsWith(";") ? source : `${source};`) : source;
	const data = parser.feed(sanitized);

	if (data.results.length !== 1) {
		const logsDir = resolve(process.cwd(), "./.logs");

		if (!fs.existsSync(logsDir)) {
			fs.mkdirSync(logsDir, { recursive: true });
		}
		fs.writeFileSync(resolve(logsDir, "error.json"), JSON.stringify(data.results, undefined, 2));
		throw new Error(`Ambiguous parse: ${data.results.length} results. Check .logs/error.json`);
	}

	if (rule === "Script") {
		const { script }: Src.Script = data.results[0];

		if (script.length === 0) {
			throw new Error("Empty script");
		}
		return script[0];
	}

	return data.results[0] as Src.Term;
};

export const run = (source: string, opts: Options): Result => {
	const result = { ...empty, source };
	const db = deBruijnOpts(opts.deBruijn);

	const attempt = <T>(phase: string, fn: () => T): T | undefined => {
		try {
			return fn();
		} catch (e) {
			result.errors = [...result.errors, `[${phase}] ${e instanceof Error ? e.message : String(e)}`];
			return undefined;
		}
	};

	const parsed = attempt("Parse", () => parse(source, opts.parserRule));

	if (!parsed) {
		return result;
	}

	const stmt: Src.Statement = opts.parserRule === "Ann" ? ({ type: "expression", value: parsed as Src.Term } as Src.Statement) : (parsed as Src.Statement);

	if (stmt.type !== "expression") {
		result.parsed = Src.Stmt.display(stmt);

		if (opts.rawJson) {
			result.raw.parsed = stmt;
		}
		return result;
	}

	result.parsed = Src.display(stmt.value);

	if (opts.rawJson) {
		result.raw.parsed = stmt.value;
	}

	const elaborated = attempt("Elaboration", () => EB.Mod.expression(stmt, defaultContext));
	if (!elaborated || E.isLeft(elaborated)) {
		if (elaborated && E.isLeft(elaborated)) {
			result.errors = [...result.errors, `[Elaboration] ${EB.V2.display(elaborated.left)}`];
		}
		return result;
	}

	const [tm, ty, _us, ctx, debug] = elaborated.right;

	result.elaborated = attempt("Typechecker / display", () => EB.Display.Term(tm, ctx, db)) ?? "";

	if (debug) {
		const displayCtx = { zonker: ctx.zonker, metas: ctx.metas, env: ctx.env };
		result.constraints =
			attempt("Typechecker / constraints", () => {
				if (debug.constraints.length === 0) {
					return "No constraints";
				}
				return debug.constraints
					.map((c, i) => {
						const prefix = `[${i}] `;
						if (c.type === "assign") {
							const l = EB.NF.display(c.left, displayCtx, db);
							const r = EB.NF.display(c.right, displayCtx, db);
							return `${prefix}${l}  ~  ${r}`;
						}
						return `${prefix}resolve ?${c.meta.val}`;
					})
					.join("\n");
			}) ?? "";

		result.metas =
			attempt("Typechecker / metas", () => {
				const zonkerStr = Sub.display(debug.zonker, ctx.metas);
				const resKeys = Object.keys(debug.resolutions);
				const resSection =
					resKeys.length > 0
						? `\n\nResolutions:\n${resKeys.map(k => `  ?${k} |=> ${EB.Display.Term(debug.resolutions[Number(k)], displayCtx, db)}`).join("\n")}`
						: "";
				const metaKeys = Object.keys(ctx.metas);
				const metaSection =
					metaKeys.length > 0
						? `\n\nMetas (${metaKeys.length}):\n${metaKeys
								.map(k => {
									const m = ctx.metas[Number(k)];
									return `  ?${k} : ${EB.NF.display(m.ann, displayCtx, db)}`;
								})
								.join("\n")}`
						: "";
				return `Zonker:\n${zonkerStr}${resSection}${metaSection}`;
			}) ?? "";
	}

	if (opts.rawJson) {
		result.raw.elaborated = tm;
	}

	const quoted = attempt("Typechecker / quote", () => EB.NF.quote(ctx, ctx.env.length, ty));
	result.type = quoted ? (attempt("Typechecker / display", () => EB.Display.Term(quoted, ctx, db)) ?? "") : "";

	if (opts.rawJson && quoted) {
		result.raw.type = quoted;
	}

	if (opts.deBruijn === "both" && quoted) {
		result.type += `\n\n--- NF ---\n${attempt("Typechecker / normalize", () => EB.NF.display(ty, ctx, db)) ?? ""}`;
	}

	if (opts.evaluate) {
		const nf = attempt("Normalization", () => EB.NF.evaluate(ctx, tm));
		result.normalized = nf ? (attempt("Normalization / display", () => EB.NF.display(nf, ctx, db)) ?? "") : "";

		if (opts.deBruijn === "both" && nf) {
			const quotedNF = attempt("Normalization / quote", () => EB.NF.quote(ctx, ctx.env.length, nf));
			if (quotedNF) {
				result.normalized += `\n\n--- Quoted ---\n${attempt("Normalization / display", () => EB.Display.Term(quotedNF, ctx, db)) ?? ""}`;
			}
		}
	}

	Build.simplify = opts.ivlSimplify;
	const ivlArtefacts = attempt("Verification / IVL", () => {
		const V2 = VerificationServiceV2();
		const [{ result: res }] = V2.check(tm, ty)(ctx);

		if (res._tag === "Left") {
			return undefined;
		}
		return res.right;
	});

	if (ivlArtefacts) {
		result.ivl = attempt("Verification / IVL display", () => IVLPrint.formula(ivlArtefacts.vc)) ?? "";
		result.validity = attempt("Verification / validity", () => Validity.display(Validity.check(ivlArtefacts.vc))) ?? "";

		result.solverTrace =
			attempt("Verification / solver trace", () => {
				const checked = Solver.run(ivlArtefacts.vc);
				return Replay.replay({ formula: IVLPrint.formula(ivlArtefacts.vc), steps: checked.steps, encoding: checked.encoding, arena: checked.arena });
			}) ?? "";
	}

	const arities = Pipeline.deriveAritiesFromContext(ctx);
	const gramResult = attempt("IR / GRAM", () => GRAM.Pipeline.compile(tm, { zonker: ctx.zonker, arities }));

	const gramGraph = gramResult && E.isRight(gramResult) ? gramResult.right : undefined;
	result.gram = gramGraph ? (attempt("IR / GRAM display", () => GRAM.display(gramGraph)) ?? "") : "";
	result.gramDot = gramGraph ? (attempt("IR / DOT", () => GRAM.dot(gramGraph)) ?? "") : "";

	if (gramResult && E.isLeft(gramResult)) {
		result.errors = [...result.errors, `[IR / GRAM] ${JSON.stringify(gramResult.left)}`];
	}

	const mod = gramGraph ? (attempt("IR / MIR bridge", () => GRAM.Bridge.emit(gramGraph)) ?? undefined) : undefined;
	result.mir = mod ? (attempt("IR / MIR display", () => MIR.display.module(mod)) ?? "") : "";

	if (opts.rawJson && mod) {
		result.raw.mir = mod;
	}

	if (mod) {
		result.codegenJS = attempt("Codegen / JavaScript emit", () => printJS(emitJS(mod))) ?? "";
		result.codegenC = attempt("Codegen / C emit", () => printC(emitC(mod))) ?? "";
		result.codegenErlang = attempt("Codegen / Erlang emit", () => printErl(emitErl(mod))) ?? "";
		result.output = result.codegenJS ? (attempt("Codegen / JavaScript execution", () => display(executeJS(result.codegenJS))) ?? "") : "";
		result.interpreted = opts.interpret ? (attempt("IR / MIR interpretation", () => display(Pipeline.run(mod, Pipeline.emptyRuntime()))) ?? "") : "";
	}

	if (result.errors.length > 0) {
		const logsDir = resolve(process.cwd(), "./.logs");

		if (!fs.existsSync(logsDir)) {
			fs.mkdirSync(logsDir, { recursive: true });
		}
		fs.writeFileSync(resolve(logsDir, "error.json"), JSON.stringify({ errors: result.errors, result }, undefined, 2));
	}

	return result;
};
