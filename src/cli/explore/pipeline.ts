import Nearley from "nearley";
import Grammar from "@yap/src/grammar";

import * as Src from "@yap/src/index";
import * as EB from "@yap/elaboration";
import * as GRAM from "@yap/gram";
import { closureConvert } from "../../GRAM/passes/closure";
import { eta } from "../../GRAM/passes/eta";
import { saturate } from "../../GRAM/passes/saturate";

import * as E from "fp-ts/lib/Either";
import fs from "fs";
import { resolve } from "path";

import { defaultContext } from "@yap/shared/lib/constants";
import { lowerToMir } from "../../lowering/lower";
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
import { Solver } from "../../verification/solver/solver";
import { Trace } from "../../verification/solver/trace";

export type DeBruijnMode = "off" | "index" | "level" | "both";
export type ParserRule = "Ann" | "Script";

export type Options = {
	deBruijn: DeBruijnMode;
	parserRule: ParserRule;
	rawJson: boolean;
	ivlSimplify: boolean;
};

export type Result = {
	source: string;
	parsed: string;
	elaborated: string;
	type: string;
	normalized: string;
	constraints: string;
	metas: string;
	ivl: string;
	solverTrace: string;
	mir: string;
	gram: string;
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
	normalized: "",
	constraints: "",
	metas: "",
	ivl: "",
	solverTrace: "",
	mir: "",
	gram: "",
	codegenJS: "",
	codegenC: "",
	codegenErlang: "",
	errors: [],
	raw: {},
};

const deBruijnOpts = (mode: DeBruijnMode) => ({
	deBruijn: mode === "index" || mode === "level" || mode === "both",
});

const attempt = <T>(fn: () => T, errors: string[]): T | undefined => {
	try {
		return fn();
	} catch (e) {
		errors.push(e instanceof Error ? e.message : String(e));
		return undefined;
	}
};

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
		fs.writeFileSync(resolve(logsDir, "error.json"), JSON.stringify(data.results, null, 2));
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

export const run = async (source: string, opts: Options): Promise<Result> => {
	const errors: string[] = [];
	const result = { ...empty, source };
	const db = deBruijnOpts(opts.deBruijn);

	const parsed = attempt(() => parse(source, opts.parserRule), errors);

	if (!parsed) {
		return { ...result, errors };
	}

	const stmt: Extract<Src.Statement, { type: "expression" }> =
		opts.parserRule === "Ann" ? { type: "expression", value: parsed as Src.Term } : (parsed as Src.Statement);

	if (stmt.type !== "expression") {
		result.parsed = Src.Stmt.display(stmt);

		if (opts.rawJson) {
			result.raw.parsed = stmt;
		}
		return { ...result, errors };
	}

	result.parsed = Src.display(stmt.value);

	if (opts.rawJson) {
		result.raw.parsed = stmt.value;
	}

	const elaborated = attempt(() => EB.Mod.expression(stmt, defaultContext), errors);
	if (!elaborated || E.isLeft(elaborated)) {
		if (elaborated && E.isLeft(elaborated)) {
			errors.push(EB.V2.display(elaborated.left));
		}
		return { ...result, errors };
	}

	const [tm, ty, _us, ctx, debug] = elaborated.right;

	result.elaborated = attempt(() => EB.Display.Term(tm, { ...ctx, skolems: debug?.skolems }, db), errors) ?? "";

	if (debug) {
		const displayCtx = { zonker: ctx.zonker, metas: ctx.metas, env: ctx.env, skolems: debug.skolems };
		result.constraints =
			attempt(() => {
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
			}, errors) ?? "";

		result.metas =
			attempt(() => {
				const sections: string[] = [];
				const zonkerStr = Sub.display(debug.zonker, ctx.metas);
				sections.push(`Zonker:\n${zonkerStr}`);
				const resKeys = Object.keys(debug.resolutions);
				if (resKeys.length > 0) {
					const resStr = resKeys.map(k => `  ?${k} |=> ${EB.Display.Term(debug.resolutions[Number(k)], displayCtx, db)}`).join("\n");
					sections.push(`\nResolutions:\n${resStr}`);
				}
				const skolemKeys = Object.keys(debug.skolems);
				if (skolemKeys.length > 0) {
					const skolemStr = skolemKeys.map(k => `  ?${k} := ${EB.Display.Term(debug.skolems[Number(k)], displayCtx, db)}`).join("\n");
					sections.push(`\nSkolems (${skolemKeys.length}):\n${skolemStr}`);
				}
				const metaKeys = Object.keys(ctx.metas);
				if (metaKeys.length > 0) {
					const metaStr = metaKeys
						.map(k => {
							const m = ctx.metas[Number(k)];
							return `  ?${k} : ${EB.NF.display(m.ann, displayCtx, db)}`;
						})
						.join("\n");
					sections.push(`\nMetas (${metaKeys.length}):\n${metaStr}`);
				}
				return sections.join("\n");
			}, errors) ?? "";
	}

	if (opts.rawJson) {
		result.raw.elaborated = tm;
	}

	const quoted = attempt(() => EB.NF.quote(ctx, ctx.env.length, ty), errors);
	result.type = quoted ? (attempt(() => EB.Display.Term(quoted, ctx, db), errors) ?? "") : "";

	if (opts.rawJson && quoted) {
		result.raw.type = quoted;
	}

	if (opts.deBruijn === "both" && quoted) {
		result.type += `\n\n--- NF ---\n${attempt(() => EB.NF.display(ty, ctx, db), errors) ?? ""}`;
	}

	const nf = attempt(() => EB.NF.evaluate(ctx, tm), errors);
	result.normalized = nf ? (attempt(() => EB.NF.display(nf, ctx, db), errors) ?? "") : "";

	if (opts.deBruijn === "both" && nf) {
		const quotedNF = attempt(() => EB.NF.quote(ctx, ctx.env.length, nf), errors);
		if (quotedNF) {
			result.normalized += `\n\n--- Quoted ---\n${attempt(() => EB.Display.Term(quotedNF, ctx, db), errors) ?? ""}`;
		}
	}

	Build.simplify = opts.ivlSimplify;
	const ivlArtefacts = attempt(() => {
		const V2 = VerificationServiceV2();
		const [{ result: res }] = V2.check(tm, ty)(ctx);

		if (res._tag === "Left") {
			return undefined;
		}
		//const x = V2.getObligations().forEach(o => o.)
		return res.right;
	}, errors);

	if (ivlArtefacts) {
		result.ivl = attempt(() => IVLPrint.formula(ivlArtefacts.vc), errors) ?? "";

		result.solverTrace =
			attempt(() => {
				const solver = Solver.createTraced();
				solver.assert(ivlArtefacts.vc);
				const { trace, atoms, proxies, clauses, arena } = solver.check();
				const { steps } = Trace.collect(trace);
				return Trace.replay({ formula: IVLPrint.formula(ivlArtefacts.vc), steps, atoms, proxies, clauses, arena });
			}, errors) ?? "";
	}

	const declarations = new Map();
	const mod = attempt(() => lowerToMir(tm, declarations), errors);
	result.mir = mod ? (attempt(() => MIR.display.module(mod), errors) ?? "") : "";

	if (opts.rawJson && mod) {
		result.raw.mir = mod;
	}

	const rawGraph = attempt(() => GRAM.translate(tm, { skolems: debug?.skolems, zonker: ctx.zonker }), errors);
	const graph = rawGraph ? attempt(() => closureConvert(saturate(eta(rawGraph))), errors) : undefined;
	result.gram = graph ? (attempt(() => GRAM.display(graph), errors) ?? "") : "";

	if (mod) {
		result.codegenJS = attempt(() => printJS(emitJS(mod)), errors) ?? "";
		result.codegenC = attempt(() => printC(emitC(mod)), errors) ?? "";
		result.codegenErlang = attempt(() => printErl(emitErl(mod)), errors) ?? "";
	}

	if (errors.length > 0) {
		const logsDir = resolve(process.cwd(), "./.logs");

		if (!fs.existsSync(logsDir)) {
			fs.mkdirSync(logsDir, { recursive: true });
		}
		fs.writeFileSync(resolve(logsDir, "error.json"), JSON.stringify({ errors, result }, null, 2));
	}

	return { ...result, errors };
};
