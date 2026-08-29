import Nearley from "nearley";
import Grammar from "@yap/src/grammar";

import * as Eff from "@yap/utils/effects";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Errors from "@yap/elaboration/shared/errors";
import * as NF from "@yap/elaboration/normalization";
import * as Lib from "@yap/shared/lib/primitives";
import { omit } from "lodash/fp";
import { options } from "@yap/shared/config/options";
import { match } from "ts-pattern";

// Create a fresh parser for expressions (Ann grammar start)
export const mkParser = () => {
	const g = { ...Grammar, ParserStart: "Ann" };
	return new Nearley.Parser(Nearley.Grammar.fromCompiled(g), { keepHistory: true });
};

export const parseExpr = (src: string) => {
	const parser = mkParser();
	const data = parser.feed(src);
	if (data.results.length !== 1) {
		throw new Error(`Ambiguous or failed parse: expected 1 result, got ${data.results.length}`);
	}
	return data.results[0];
};

export const mkCtx = (): EB.Context => Lib.defaultContext();

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const TypeText = {
	lit: (name: "Num" | "String" | "Bool" | "Unit" | "Type" | "Row"): string => escapeRegExp(name),
	meta: String.raw`\?\d+`,
	schema: "Schema",
} as const;

export const Field = {
	bare: (label: string, ty: string): RegExp => new RegExp(String.raw`\b${escapeRegExp(label)}:\s+${ty}\b`),
	modal: (label: string, ty: string): RegExp => new RegExp(String.raw`\b${escapeRegExp(label)}:\s+<[^>]+>\s+${ty}\b`),
	type: (label: string, ty: string): RegExp => new RegExp(String.raw`\b${escapeRegExp(label)}:\s+(?:<[^>]+>\s+)?${ty}\b`),
	schema: (label: string, ...fields: readonly RegExp[]): RegExp =>
		match(fields)
			.with([], () => new RegExp(String.raw`\b${escapeRegExp(label)}:\s+Schema\b`))
			.otherwise(fs => new RegExp(String.raw`\b${escapeRegExp(label)}:\s+Schema\s+\[\s*${fs.map(f => f.source).join(String.raw`[\s\S]*?`)}[\s\S]*?\]`)),
	meta: (label: string): RegExp => new RegExp(String.raw`\b${escapeRegExp(label)}:\s+${TypeText.meta}\b`),
} as const;

export const Liquid = {
	mentions: (symbol: string): RegExp => new RegExp(escapeRegExp(symbol)),
} as const;

const initialState = (): M.MutState => ({ delimitations: [], nondeterminism: { solution: {} } });

/** Runs an elaboration program with a fresh handler set; answers with every handler's output. */
export const runEB = <A>(ctx: EB.Context, program: () => M.Elaboration<A>, registry: Metas.Registry = Metas.empty) => {
	const [answer, collected, , , state, counts, metas, trace] = Eff.run(program, [
		M.writer.handlers(),
		M.reader.handlers(ctx),
		M.except.handlers(),
		M.st.handlers(initialState()),
		M.supply.handlers(),
		Metas.registry.handlers(registry),
		M.tracer.handlers(),
		M.recursion.handlers(),
	]);

	return { answer, collected, state, counts, registry: metas, trace } as const;
};

/** Displays and other read-only programs run over a finished run's outputs. */
export const shown = (ctx: EB.Context, registry: Metas.Registry) => {
	type Readonly<A> = () => Eff.Eff<Eff.Actions<typeof M.reader> | Eff.Only<typeof Metas.registry, "Registry.get">, A>;

	return <A>(program: Readonly<A>): A => Eff.run(program, [M.reader.handlers(ctx), Metas.registry.handlers(registry)])[0];
};

/** Runs a public-NbE program (reader + registry row) with a fresh machine. */
export const runNF = <A>(
	ctx: EB.Context,
	program: () => Eff.Eff<Eff.Actions<[typeof M.reader, typeof Metas.registry]>, A>,
	registry: Metas.Registry = Metas.empty,
): A => {
	const [value] = Eff.run(program, [M.reader.handlers(ctx), Metas.registry.handlers(registry)]);

	return value;
};

// Run elaboration/inference for a source string; returns elaborated term, type, usages, constraints and displays.
export const elaborateFrom = (src: string) => {
	EB.resetSupply("meta");
	EB.resetSupply("var");
	EB.resetId();
	NF.resetId();
	options.verbose = true;
	const term = parseExpr(src);
	const ctx = mkCtx();

	const { answer, collected, state, registry } = runEB(ctx, () => EB.infer(term));

	const disp = shown(ctx, registry);
	/* Constraints are what unification was asked to prove, so they show the metas as posed. */
	const posed = shown(ctx, Metas.unsolved(registry));

	if (Eff.failed(answer)) {
		throw new Error(disp(() => Errors.report(answer[Eff.ABORT])));
	}

	const [tm, ty] = answer;
	const constraints = collected.constraints.map(c => (c.type === "assign" ? omit("trace", c) : c));
	const zonker = Metas.solutions(registry);

	const pretty = {
		term: disp(() => EB.Display.Term(tm)),
		type: disp(() => NF.display(ty)),
		constraints: constraints.map((c: any) => posed(() => EB.Display.Constraint(c))),
	};

	// Build a snapshot-friendly object
	return {
		src,
		displays: pretty,
		structure: {
			term: tm,
			type: ty,
			constraints,
			metas: registry,
			typedTerms: {},
		},
		state,
		zonker,
		registry,
	};
};
