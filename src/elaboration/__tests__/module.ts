import Nearley from "nearley";
import Grammar from "@yap/src/grammar";
import * as Src from "@yap/src/index";

import * as Eff from "@yap/utils/effects";
import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Errors from "@yap/elaboration/shared/errors";
import * as NF from "@yap/elaboration/normalization";

import * as E from "fp-ts/lib/Either";
import { match } from "ts-pattern";
import { set } from "@yap/utils";
import { defaultContext } from "@yap/shared/lib/constants";

/**
 * Elaborates a multi-statement script the way module loading does: each statement
 * runs at the module boundary and its context threads into the next, so `using`
 * populates the implicit environment that later declarations resolve against.
 *
 * Elaboration only. Downstream stages (verification, GRAM, MIR, codegen) layer on
 * top of this — see the integration pipeline helper — so a pass-level invariant can
 * be asserted here without a backend break colouring the result.
 */

export type Kind = "let" | "foreign" | "using" | "expression";

/** What a `let` or expression statement produced, at the point it produced it. */
export type Elaborated = {
	readonly tm: EB.Term;
	readonly ty: NF.Value;
	readonly ctx: EB.Context;
	readonly registry: Metas.Registry;
};

export type Declaration = {
	readonly name: string;
	readonly kind: Kind;
	readonly elaborated?: Elaborated;
	readonly error?: string;
};

export type ModuleResult = { readonly declarations: ReadonlyArray<Declaration> };

/** Errors render at a boundary run over their own captured scope. */
const rendered = (e: M.Err): string => Eff.run(() => Errors.report(e), [M.reader.handlers(e.ctx), Metas.registry.handlers({})])[0];

const flatten = <A>(result: E.Either<M.Err, A>): E.Either<string, A> => E.mapLeft(rendered)(result);

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

type Acc = { readonly ctx: EB.Context; readonly boundary: EB.Mod.Boundary; readonly declarations: ReadonlyArray<Declaration> };

/** A failed statement records its error and leaves the context where it was. */
const keep = (acc: Acc, decl: Declaration): Acc => ({
	ctx: acc.ctx,
	boundary: acc.boundary,
	declarations: [...acc.declarations, decl],
});

const advance = (acc: Acc, decl: Declaration, ctx: EB.Context, boundary: EB.Mod.Boundary): Acc => ({
	ctx,
	boundary,
	declarations: [...acc.declarations, decl],
});

/** `foreign` and `using` contribute context, not a term. */
const withContext = (acc: Acc, name: string, kind: Kind, result: E.Either<string, [EB.Context, EB.Mod.Boundary]>): Acc =>
	E.fold(
		(error: string) => keep(acc, { name, kind, error }),
		([ctx, boundary]: [EB.Context, EB.Mod.Boundary]) => advance(acc, { name, kind }, ctx, boundary),
	)(result);

const withElaborated = (acc: Acc, name: string, kind: Kind, result: E.Either<string, [Elaborated, EB.Mod.Boundary]>): Acc =>
	E.fold(
		(error: string) => keep(acc, { name, kind, error }),
		([elaborated, boundary]: [Elaborated, EB.Mod.Boundary]) => advance(acc, { name, kind, elaborated }, elaborated.ctx, boundary),
	)(result);

const process = (acc: Acc, stmt: Src.Statement): Acc =>
	match(stmt)
		.with({ type: "foreign" }, s => withContext(acc, s.variable, "foreign", Elaborate.foreign(s, acc.ctx, acc.boundary)))
		.with({ type: "using" }, s => withContext(acc, "(using)", "using", Elaborate.using(s, acc.ctx, acc.boundary)))
		.with({ type: "let" }, s => withElaborated(acc, s.variable, "let", Elaborate.letdec(s, acc.ctx, acc.boundary)))
		.with({ type: "expression" }, s => withElaborated(acc, "(expr)", "expression", Elaborate.expression(s, acc.ctx, acc.boundary)))
		.otherwise(() => acc);

export const elaborateModule = (source: string): ModuleResult => {
	reset();
	return parse(source).reduce(process, { ctx: { ...defaultContext }, boundary: { registry: Metas.empty, counts: {} }, declarations: [] });
};

/** The declaration a name bound, or undefined if the statement never elaborated. */
export const declaration = (result: ModuleResult, name: string): Declaration | undefined => result.declarations.find(d => d.name === name);
