import Nearley from "nearley";
import Grammar from "@yap/src/grammar";
import * as Src from "@yap/src/index";
import * as Eff from "@yap/utils/effects";
import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Errors from "@yap/elaboration/shared/errors";
import * as NF from "@yap/elaboration/normalization";
import * as GRAM from "@yap/gram";
import * as E from "fp-ts/lib/Either";
import * as T from "fp-ts/lib/These";
import * as O from "fp-ts/lib/Option";
import * as RNEA from "fp-ts/lib/ReadonlyNonEmptyArray";
import { match } from "ts-pattern";
import { set } from "@yap/utils";
import { defaultContext } from "@yap/shared/lib/constants";
import { ARITIES } from "../../../lowering/shared/primops";
import type { Module } from "../../../lowering/mir";
import * as MIR from "../../../lowering/pretty";
import { emit as emitJS } from "../../../Codegen/v2/js/emit";
import { print as printJS } from "../../../Codegen/v2/js/print";
import { emit as emitC } from "../../../Codegen/v2/c/emit";
import { print as printC } from "../../../Codegen/v2/c/print";
import { emit as emitErl } from "../../../Codegen/v2/erlang/emit";
import { print as printErl } from "../../../Codegen/v2/erlang/print";
import { VerificationServiceV2 } from "../../../verification/V2/service";
import type { VerificationArtefacts } from "../../../verification/V2/types";
import { Build } from "../../../verification/solver/ivl/build";
import { Print as IVLPrint } from "../../../verification/solver/ivl/print";
import { Solver } from "../../../verification/solver/v2/solver";
import * as Replay from "../../../verification/solver/v2/trace/replay";
import { Validity } from "../../../verification/validity";
import { shown } from "../../../elaboration/inference/__tests__/util";

type StageName = "elaborated" | "type" | "normalized" | "ivl" | "validity" | "solverTrace" | "gram" | "mir" | "codegenJS" | "codegenC" | "codegenErlang";
export type StageResults = { readonly [K in StageName]: string };

export type DeclarationResult = {
	readonly name: string;
	readonly kind: "let" | "foreign" | "using" | "expression";
	readonly stages?: StageResults;
	readonly error?: string;
};

export type ScriptResult = { readonly declarations: ReadonlyArray<DeclarationResult> };

type Elaborated = {
	readonly tm: EB.Term;
	readonly ty: NF.Value;
	readonly ctx: EB.Context;
	readonly registry: Metas.Registry;
};

const safe = <A>(fn: () => A): E.Either<string, A> => E.tryCatch(fn, e => (e instanceof Error ? e.message : String(e)));

/** Errors render at a boundary run over their own captured scope. */
const rendered = (e: M.Err): string => Eff.run(() => Errors.report(e), [M.reader.handlers(e.ctx), Metas.registry.handlers({})])[0];

const flatten = <A>(result: E.Either<M.Err, A>): E.Either<string, A> => E.mapLeft(rendered)(result);

const get = E.getOrElse((): string => "");

const errs = (rs: ReadonlyArray<E.Either<string, unknown>>): ReadonlyArray<string> =>
	rs.flatMap(
		E.fold(
			e => [e],
			() => [],
		),
	);

const toThese = <A>(errors: ReadonlyArray<string>, value: A): T.These<ReadonlyArray<string>, A> => T.rightOrBoth(value)(RNEA.fromReadonlyArray(errors));

const pipeline = (
	tm: EB.Term,
	ty: NF.Value,
	ctx: EB.Context,
	registry: Metas.Registry,
	parentBinders?: ReadonlyArray<string>,
): T.These<ReadonlyArray<string>, StageResults> => {
	const db = { deBruijn: false };
	const disp = shown(ctx, registry);

	const elaborated = safe(() => disp(() => EB.Display.Term(tm, db)));
	const type = safe(() =>
		disp(function* () {
			return yield* EB.Display.Term(yield* NF.quote(ctx.env.length, ty), db);
		}),
	);
	const normalized = safe(() =>
		disp(function* () {
			return yield* NF.display(yield* NF.evaluate(tm), db);
		}),
	);

	Build.simplify = true; // global state required by the verification library
	const verified = safe(() => {
		const svc = VerificationServiceV2();
		const { answer } = svc.check(tm, ty, ctx, registry);
		return answer;
	});
	const artefacts = E.map((a: VerificationArtefacts | Eff.Aborted<M.Err>) => (Eff.failed(a) ? O.none : O.some(a)))(verified);
	const ivl = E.chain(
		O.fold(
			() => E.right<string, string>(""),
			(a: VerificationArtefacts) => safe(() => IVLPrint.formula(a.vc)),
		),
	)(artefacts);
	const validity = E.chain(
		O.fold(
			() => E.right<string, string>(""),
			(a: VerificationArtefacts) => safe(() => Validity.display(Validity.check(a.vc))),
		),
	)(artefacts);
	const solverTrace = E.chain(
		O.fold(
			() => E.right<string, string>(""),
			(a: VerificationArtefacts) =>
				safe(() => {
					const checked = Solver.run(a.vc);
					return Replay.replay({
						formula: IVLPrint.formula(a.vc),
						steps: checked.steps,
						encoding: checked.encoding,
						arena: checked.arena,
					});
				}),
		),
	)(artefacts);

	const ffiArities = Object.fromEntries(Object.entries(ctx.ffi).map(([k, v]) => [k, v.arity]));
	const arities = { ...ARITIES, ...ffiArities };
	const gramGraph = E.chain(
		E.fold(
			(e: GRAM.Pipeline.CompileError) => E.left<string, GRAM.Graph>(`GRAM: ${JSON.stringify(e)}`),
			(g: GRAM.Graph) => E.right<string, GRAM.Graph>(g),
		),
	)(safe(() => GRAM.Pipeline.compile(tm, { zonker: Metas.solutions(registry), arities, parentBinders })));
	const gram = E.chain((g: GRAM.Graph) => safe(() => GRAM.display(g)))(gramGraph);
	const mod = E.chain((g: GRAM.Graph) => safe(() => GRAM.Bridge.emit(g)))(gramGraph);
	const mir = E.chain((m: Module) => safe(() => MIR.display.module(m)))(mod);
	const codegenJS = E.chain((m: Module) => safe(() => printJS(emitJS(m))))(mod);
	const codegenC = E.chain((m: Module) => safe(() => printC(emitC(m))))(mod);
	const codegenErlang = E.chain((m: Module) => safe(() => printErl(emitErl(m))))(mod);

	const all = [elaborated, type, normalized, ivl, validity, solverTrace, gram, mir, codegenJS, codegenC, codegenErlang];

	return toThese(errs(all), {
		elaborated: get(elaborated),
		type: get(type),
		normalized: get(normalized),
		ivl: get(ivl),
		validity: get(validity),
		solverTrace: get(solverTrace),
		gram: get(gram),
		mir: get(mir),
		codegenJS: get(codegenJS),
		codegenC: get(codegenC),
		codegenErlang: get(codegenErlang),
	});
};

const Elaborate = {
	foreign: (stmt: Extract<Src.Statement, { type: "foreign" }>, ctx: EB.Context, boundary: EB.Mod.Boundary): E.Either<string, [EB.Context, EB.Mod.Boundary]> => {
		const [, result, next] = EB.Mod.foreign(stmt, ctx, boundary);

		return E.map(([, c1, decl]: [EB.AST, EB.Context, { arity: number }]): [EB.Context, EB.Mod.Boundary] => {
			const compute = (...args: NF.Value[]): NF.Value => {
				const ext = NF.Constructors.External(stmt.variable, decl.arity, compute, args);
				return NF.Constructors.Neutral("Sealed", ext);
			};
			return [set(c1, ["ffi", stmt.variable] as const, { arity: decl.arity, compute }), next];
		})(flatten(result));
	},

	using: (stmt: Extract<Src.Statement, { type: "using" }>, ctx: EB.Context, boundary: EB.Mod.Boundary): E.Either<string, [EB.Context, EB.Mod.Boundary]> => {
		const [result, next] = EB.Mod.using(stmt, ctx, boundary);

		return E.map((c: EB.Context): [EB.Context, EB.Mod.Boundary] => [c, next])(flatten(result));
	},

	letdec: (stmt: Extract<Src.Statement, { type: "let" }>, ctx: EB.Context, boundary: EB.Mod.Boundary): E.Either<string, [Elaborated, EB.Mod.Boundary]> => {
		const [, result, next] = EB.Mod.letdec(stmt, ctx, boundary);

		return E.map(([[tm, ty], nextCtx]: [EB.AST, EB.Context]): [Elaborated, EB.Mod.Boundary] => [{ tm, ty, ctx: nextCtx, registry: next.registry }, next])(
			flatten(result),
		);
	},

	expression: (
		stmt: Extract<Src.Statement, { type: "expression" }>,
		ctx: EB.Context,
		boundary: EB.Mod.Boundary,
	): E.Either<string, [Elaborated, EB.Mod.Boundary]> => {
		const [result, next] = EB.Mod.expression(stmt, ctx, boundary);

		return E.map(([tm, ty, , nextCtx]: readonly [EB.Term, NF.Value, unknown, EB.Context, unknown]): [Elaborated, EB.Mod.Boundary] => [
			{ tm, ty, ctx: nextCtx, registry: next.registry },
			next,
		])(flatten(result));
	},
};

const parse = (source: string): ReadonlyArray<Src.Statement> => {
	const g = { ...Grammar, ParserStart: "Script" };
	const parser = new Nearley.Parser(Nearley.Grammar.fromCompiled(g));
	const sanitized = source.trim().endsWith(";") ? source : `${source};`;
	const { results } = parser.feed(sanitized);

	if (results.length !== 1) {
		throw new Error(`Ambiguous or failed parse: expected 1, got ${results.length}`);
	}
	return (results[0] as Src.Script).script;
};

const reset = () => {
	EB.resetSupply("meta");
	EB.resetSupply("var");
	EB.resetId();
	NF.resetId();
};

type Acc = { readonly ctx: EB.Context; readonly boundary: EB.Mod.Boundary; readonly declarations: ReadonlyArray<DeclarationResult> };

const keep = (acc: Acc, decl: DeclarationResult): Acc => ({
	ctx: acc.ctx,
	boundary: acc.boundary,
	declarations: [...acc.declarations, decl],
});

const advance = (acc: Acc, decl: DeclarationResult, ctx: EB.Context, boundary: EB.Mod.Boundary): Acc => ({
	ctx,
	boundary,
	declarations: [...acc.declarations, decl],
});

const withContext = (acc: Acc, name: string, kind: DeclarationResult["kind"], result: E.Either<string, [EB.Context, EB.Mod.Boundary]>): Acc =>
	E.fold(
		(error: string) => keep(acc, { name, kind, error }),
		([ctx, boundary]: [EB.Context, EB.Mod.Boundary]) => advance(acc, { name, kind }, ctx, boundary),
	)(result);

const withStages = (acc: Acc, name: string, kind: DeclarationResult["kind"], result: E.Either<string, [Elaborated, EB.Mod.Boundary]>): Acc =>
	E.fold(
		(error: string) => keep(acc, { name, kind, error }),
		([{ tm, ty, ctx, registry }, boundary]: [Elaborated, EB.Mod.Boundary]) =>
			T.fold(
				(errors: ReadonlyArray<string>) => advance(acc, { name, kind, error: errors.join("; ") }, ctx, boundary),
				(stages: StageResults) => advance(acc, { name, kind, stages }, ctx, boundary),
				(errors: ReadonlyArray<string>, stages: StageResults) => advance(acc, { name, kind, stages, error: errors.join("; ") }, ctx, boundary),
			)(pipeline(tm, ty, ctx, registry, kind === "let" ? [name] : undefined)),
	)(result);

const process = (acc: Acc, stmt: Src.Statement): Acc =>
	match(stmt)
		.with({ type: "foreign" }, s => withContext(acc, s.variable, "foreign", Elaborate.foreign(s, acc.ctx, acc.boundary)))
		.with({ type: "using" }, s => withContext(acc, "(using)", "using", Elaborate.using(s, acc.ctx, acc.boundary)))
		.with({ type: "let" }, s => withStages(acc, s.variable, "let", Elaborate.letdec(s, acc.ctx, acc.boundary)))
		.with({ type: "expression" }, s => withStages(acc, "(expr)", "expression", Elaborate.expression(s, acc.ctx, acc.boundary)))
		.otherwise(() => acc);

export const runScript = (source: string): ScriptResult => {
	reset();
	return parse(source).reduce(process, { ctx: { ...defaultContext }, boundary: { registry: Metas.empty, counts: {} }, declarations: [] });
};

export const snap = (result: ScriptResult) =>
	result.declarations.map(d => ({
		name: d.name,
		kind: d.kind,
		...(d.error ? { error: d.error } : {}),
		...(d.stages
			? {
					type: d.stages.type,
					elaborated: d.stages.elaborated,
					normalized: d.stages.normalized,
					ivl: d.stages.ivl,
					validity: d.stages.validity,
					solverTrace: d.stages.solverTrace,
					gram: d.stages.gram,
					mir: d.stages.mir,
					codegenJS: d.stages.codegenJS,
				}
			: {}),
	}));
