import Nearley from "nearley";
import Grammar from "@yap/src/grammar";
import * as Src from "@yap/src/index";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as GRAM from "@yap/gram";
import * as E from "fp-ts/lib/Either";
import * as T from "fp-ts/lib/These";
import * as O from "fp-ts/lib/Option";
import * as A from "fp-ts/lib/Array";
import * as RNEA from "fp-ts/lib/ReadonlyNonEmptyArray";
import { pipe } from "fp-ts/lib/function";
import { match } from "ts-pattern";
import { update, set } from "@yap/utils";
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
import { Solver } from "../../../verification/solver/solver";
import { Trace } from "../../../verification/solver/trace";

type StageName = "elaborated" | "type" | "normalized" | "ivl" | "solverTrace" | "gram" | "mir" | "codegenJS" | "codegenC" | "codegenErlang";
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
};

const safe = <A>(fn: () => A): E.Either<string, A> => E.tryCatch(fn, e => (e instanceof Error ? e.message : String(e)));

const flatten = <A>(result: E.Either<V2.Err, A>): E.Either<string, A> => E.mapLeft(EB.V2.display)(result);

const get = E.getOrElse((): string => "");

const errs = (rs: ReadonlyArray<E.Either<string, unknown>>): ReadonlyArray<string> =>
	rs.flatMap(
		E.fold(
			e => [e],
			() => [],
		),
	);

const toThese = <A>(errors: ReadonlyArray<string>, value: A): T.These<ReadonlyArray<string>, A> => T.rightOrBoth(value)(RNEA.fromReadonlyArray(errors));

const pipeline = (tm: EB.Term, ty: NF.Value, ctx: EB.Context, parentBinders?: ReadonlyArray<string>): T.These<ReadonlyArray<string>, StageResults> => {
	const db = { deBruijn: false };

	const elaborated = safe(() => EB.Display.Term(tm, ctx, db));
	const type = E.chain((q: EB.Term) => safe(() => EB.Display.Term(q, ctx, db)))(safe(() => EB.NF.quote(ctx, ctx.env.length, ty)));
	const normalized = E.chain((nf: NF.Value) => safe(() => EB.NF.display(nf, ctx, db)))(safe(() => EB.NF.evaluate(ctx, tm)));

	Build.simplify = true; // global state required by the verification library
	const verified = safe(() => {
		const svc = VerificationServiceV2();
		const [{ result }] = svc.check(tm, ty)(ctx);
		return result;
	});
	const artefacts = E.map((r: E.Either<V2.Err, VerificationArtefacts>) => O.fromEither(r))(verified);
	const ivl = E.chain(
		O.fold(
			() => E.right<string, string>(""),
			(a: VerificationArtefacts) => safe(() => IVLPrint.formula(a.vc)),
		),
	)(artefacts);
	const solverTrace = E.chain(
		O.fold(
			() => E.right<string, string>(""),
			(a: VerificationArtefacts) =>
				safe(() => {
					const solver = Solver.createTraced();
					solver.assert(a.vc);
					const checked = solver.check();
					const { steps } = Trace.collect(checked.trace);
					return Trace.replay({
						formula: IVLPrint.formula(a.vc),
						steps,
						atoms: checked.atoms,
						proxies: checked.proxies,
						clauses: checked.clauses,
						arena: checked.arena,
					});
				}),
		),
	)(artefacts);

	const gramGraph = E.chain(
		E.fold(
			(e: GRAM.Pipeline.CompileError) => E.left<string, GRAM.Graph>(`GRAM: ${JSON.stringify(e)}`),
			(g: GRAM.Graph) => E.right<string, GRAM.Graph>(g),
		),
	)(safe(() => GRAM.Pipeline.compile(tm, { zonker: ctx.zonker, arities: ARITIES, parentBinders, ctx })));
	const gram = E.chain((g: GRAM.Graph) => safe(() => GRAM.display(g)))(gramGraph);
	const mod = E.chain((g: GRAM.Graph) => safe(() => GRAM.Bridge.emit(g)))(gramGraph);
	const mir = E.chain((m: Module) => safe(() => MIR.display.module(m)))(mod);
	const codegenJS = E.chain((m: Module) => safe(() => printJS(emitJS(m))))(mod);
	const codegenC = E.chain((m: Module) => safe(() => printC(emitC(m))))(mod);
	const codegenErlang = E.chain((m: Module) => safe(() => printErl(emitErl(m))))(mod);

	const all = [elaborated, type, normalized, ivl, solverTrace, gram, mir, codegenJS, codegenC, codegenErlang];

	return toThese(errs(all), {
		elaborated: get(elaborated),
		type: get(type),
		normalized: get(normalized),
		ivl: get(ivl),
		solverTrace: get(solverTrace),
		gram: get(gram),
		mir: get(mir),
		codegenJS: get(codegenJS),
		codegenC: get(codegenC),
		codegenErlang: get(codegenErlang),
	});
};

const Elaborate = {
	foreign: (stmt: Extract<Src.Statement, { type: "foreign" }>, ctx: EB.Context): E.Either<string, EB.Context> =>
		pipe(
			safe(() => EB.check(stmt.annotation, NF.Type)(ctx)),
			E.chain(([{ result }]) => flatten(result)),
			E.chain(([tm]) =>
				safe(() => {
					const nf = NF.evaluate(ctx, tm);
					const v = EB.Constructors.Var({ type: "Foreign", name: stmt.variable });
					return set(ctx, ["imports", stmt.variable] as const, [v, nf, []] satisfies EB.AST);
				}),
			),
		),

	using: (stmt: Extract<Src.Statement, { type: "using" }>, ctx: EB.Context): E.Either<string, EB.Context> =>
		pipe(
			safe(() => EB.Stmt.infer(stmt)(ctx)),
			E.chain(([{ result }]) => flatten(result)),
			E.map(([t, ty]) => update(ctx, "implicits", A.append<EB.Context["implicits"][number]>([t.value, ty]))),
		),

	letdec: (stmt: Extract<Src.Statement, { type: "let" }>, ctx: EB.Context): E.Either<string, Elaborated> =>
		pipe(
			safe(() =>
				V2.Do(function* () {
					const [elaborated, , us] = yield* EB.Stmt.infer.gen(stmt);

					if (elaborated.type !== "Let") {
						throw new Error("Expected Let from let inference");
					}
					const [r, next] = yield* EB.Stmt.letdec(elaborated);
					return { r, us, next };
				})(ctx),
			),
			E.chain(([{ result }]) => flatten(result)),
			E.map(({ r, us, next }) => ({
				tm: r.value,
				ty: r.annotation,
				ctx: set(next, ["imports", stmt.variable] as const, [r.value, r.annotation, us] satisfies EB.AST),
			})),
		),

	expression: (stmt: Extract<Src.Statement, { type: "expression" }>, ctx: EB.Context): E.Either<string, Elaborated> =>
		pipe(
			safe(() => EB.Mod.expression(stmt, ctx)),
			E.chain(flatten),
			E.map(([tm, ty, , next]) => ({ tm, ty, ctx: next })),
		),
};

const parse = (source: string): ReadonlyArray<Src.Statement> => {
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Nearley requires ParserStart override
	const g = { ...Grammar, ParserStart: "Script" } as typeof Grammar;
	const parser = new Nearley.Parser(Nearley.Grammar.fromCompiled(g));
	const sanitized = source.trim().endsWith(";") ? source : `${source};`;
	const { results } = parser.feed(sanitized);

	if (results.length !== 1) {
		throw new Error(`Ambiguous or failed parse: expected 1, got ${results.length}`);
	}
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Nearley results are untyped
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Nearley results are untyped
	return (results[0] as Src.Script).script;
};

const reset = () => {
	EB.resetSupply("meta");
	EB.resetSupply("var");
	EB.resetId();
	NF.resetId();
};

type Acc = { readonly ctx: EB.Context; readonly declarations: ReadonlyArray<DeclarationResult> };

const keep = (acc: Acc, decl: DeclarationResult): Acc => ({
	ctx: acc.ctx,
	declarations: [...acc.declarations, decl],
});

const advance = (acc: Acc, decl: DeclarationResult, ctx: EB.Context): Acc => ({
	ctx,
	declarations: [...acc.declarations, decl],
});

const withContext = (acc: Acc, name: string, kind: DeclarationResult["kind"], result: E.Either<string, EB.Context>): Acc =>
	E.fold(
		(error: string) => keep(acc, { name, kind, error }),
		(ctx: EB.Context) => advance(acc, { name, kind }, ctx),
	)(result);

const withStages = (acc: Acc, name: string, kind: DeclarationResult["kind"], result: E.Either<string, Elaborated>): Acc =>
	E.fold(
		(error: string) => keep(acc, { name, kind, error }),
		({ tm, ty, ctx }: Elaborated) =>
			T.fold(
				(errors: ReadonlyArray<string>) => advance(acc, { name, kind, error: errors.join("; ") }, ctx),
				(stages: StageResults) => advance(acc, { name, kind, stages }, ctx),
				(errors: ReadonlyArray<string>, stages: StageResults) => advance(acc, { name, kind, stages, error: errors.join("; ") }, ctx),
			)(pipeline(tm, ty, ctx, kind === "let" ? [name] : undefined)),
	)(result);

const process = (acc: Acc, stmt: Src.Statement): Acc =>
	match(stmt)
		.with({ type: "foreign" }, s => withContext(acc, s.variable, "foreign", Elaborate.foreign(s, acc.ctx)))
		.with({ type: "using" }, s => withContext(acc, "(using)", "using", Elaborate.using(s, acc.ctx)))
		.with({ type: "let" }, s => withStages(acc, s.variable, "let", Elaborate.letdec(s, acc.ctx)))
		.with({ type: "expression" }, s => withStages(acc, "(expr)", "expression", Elaborate.expression(s, acc.ctx)))
		.otherwise(() => acc);

export const runScript = (source: string): ScriptResult => {
	reset();
	return parse(source).reduce(process, { ctx: { ...defaultContext }, declarations: [] });
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
					gram: d.stages.gram,
					mir: d.stages.mir,
					codegenJS: d.stages.codegenJS,
				}
			: {}),
	}));
