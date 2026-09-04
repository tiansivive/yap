import * as Eff from "@yap/utils/effects";
import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as NF from "@yap/elaboration/normalization";
import * as GRAM from "@yap/gram";
import * as E from "fp-ts/lib/Either";
import * as T from "fp-ts/lib/These";
import * as O from "fp-ts/lib/Option";
import * as RNEA from "fp-ts/lib/ReadonlyNonEmptyArray";
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
import * as Mod from "../../../elaboration/__tests__/module";

type StageName = "elaborated" | "type" | "normalized" | "ivl" | "validity" | "solverTrace" | "gram" | "mir" | "codegenJS" | "codegenC" | "codegenErlang";
export type StageResults = { readonly [K in StageName]: string };

export type DeclarationResult = {
	readonly name: string;
	readonly kind: Mod.Kind;
	readonly stages?: StageResults;
	readonly error?: string;
};

export type ScriptResult = { readonly declarations: ReadonlyArray<DeclarationResult> };

const safe = <A>(fn: () => A): E.Either<string, A> => E.tryCatch(fn, e => (e instanceof Error ? e.message : String(e)));

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

/** Runs the downstream stages over one elaborated declaration; elaboration failures pass straight through. */
const staged = (decl: Mod.Declaration): DeclarationResult => {
	const { name, kind, elaborated } = decl;

	if (elaborated === undefined) {
		return { name, kind, ...(decl.error === undefined ? {} : { error: decl.error }) };
	}

	const { tm, ty, ctx, registry } = elaborated;

	return T.fold(
		(errors: ReadonlyArray<string>): DeclarationResult => ({ name, kind, error: errors.join("; ") }),
		(stages: StageResults): DeclarationResult => ({ name, kind, stages }),
		(errors: ReadonlyArray<string>, stages: StageResults): DeclarationResult => ({ name, kind, stages, error: errors.join("; ") }),
	)(pipeline(tm, ty, ctx, registry, kind === "let" ? [name] : undefined));
};

export const runScript = (source: string): ScriptResult => ({ declarations: Mod.elaborateModule(source).declarations.map(staged) });

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
