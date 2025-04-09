import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as M from "@yap/elaboration/shared/monad";

import * as Q from "@yap/shared/modalities/multiplicity";

import { Either } from "fp-ts/lib/Either";

import * as E from "fp-ts/lib/Either";
import * as F from "fp-ts/lib/function";

import { set, update } from "@yap/utils";

import { Interface } from "../modules/loading";
import { solve } from "./solver";
import * as A from "fp-ts/lib/Array";

export const elaborate = (mod: Src.Module, ctx: EB.Context) => {
	const maybeExport = (name: string) => (result: Omit<Interface, "imports">) => {
		if (
			mod.exports.type === "*" ||
			(mod.exports.type === "explicit" && mod.exports.names.includes(name)) ||
			(mod.exports.type === "partial" && !mod.exports.hiding.includes(name))
		) {
			return update(result, "exports", A.append(name));
		}
		return result;
	};

	type Pair = [string, Either<EB.M.Err, EB.AST>];
	const next = (stmts: Src.Statement[], ctx: EB.Context): Omit<Interface, "imports"> => {
		if (stmts.length === 0) {
			return { foreign: [], exports: [], letdecs: [], errors: [] };
		}

		const [head, ...tail] = stmts;

		if (head.type === "using") {
			return F.pipe(
				using(head, ctx),
				E.match(
					e => update(next(tail, ctx), "errors", A.prepend(e)),
					ctx => next(tail, ctx),
				),
			);
		}

		if (head.type === "foreign") {
			const [name, result] = foreign(head, ctx);
			return F.pipe(
				result,
				E.match(
					e => update(next(tail, ctx), "foreign", A.prepend<Pair>([name, E.left(e)])),
					([ast, ctx]) => F.pipe(next(tail, ctx), update("foreign", A.prepend<Pair>([name, E.right(ast)])), maybeExport(name)),
				),
			);
		}

		if (head.type === "let") {
			const foo = letdec(head, ctx);
			const [name, result] = foo;
			return F.pipe(
				result,
				E.match(
					e => update(next(tail, ctx), "letdecs", A.prepend<Pair>([name, E.left(e)])),
					([ast, ctx]) => F.pipe(next(tail, ctx), update("letdecs", A.prepend<Pair>([name, E.right(ast)])), maybeExport(name)),
				),
			);
		}

		console.warn("Unrecognized statement", head);
		return next(tail, ctx);
	};

	return next(mod.content.script, ctx);
};

export const foreign = (stmt: Extract<Src.Statement, { type: "foreign" }>, ctx: EB.Context): [string, Either<M.Err, [EB.AST, EB.Context]>] => {
	const check = EB.check(stmt.annotation, NF.Type);
	const [result] = M.run(check, ctx);
	const e = E.Functor.map(result, ([tm, us]): [EB.AST, EB.Context] => {
		const nf = NF.evaluate(ctx, tm);
		const v = EB.Constructors.Var({ type: "Foreign", name: stmt.variable });
		return [[v, nf, us], set(ctx, ["imports", stmt.variable] as const, [v, nf, us])];
	});

	return [stmt.variable, e];
};

export const using = (stmt: Extract<Src.Statement, { type: "using" }>, ctx: EB.Context): Either<M.Err, EB.Context> => {
	const infer = EB.Stmt.infer(stmt);
	const [result] = M.run(infer, ctx);
	type Implicit = EB.Context["implicits"][0];
	return E.Functor.map(result, ([t, ty]) => update(ctx, "implicits", A.append<Implicit>([t.value, ty])));
};

export const letdec = (stmt: Extract<Src.Statement, { type: "let" }>, ctx: EB.Context): [string, Either<M.Err, [EB.AST, EB.Context]>] => {
	const inference = F.pipe(
		EB.Stmt.infer(stmt),
		M.listen(([[stmt, ty, us], { constraints }]) => {
			return { inferred: { stmt, ty, us }, constraints };
		}),
		M.bind("subst", ({ constraints }) => solve(constraints)),
		M.bind("ty", ({ inferred, subst }) => {
			return F.pipe(
				EB.zonk("nf", inferred.ty, subst),
				M.fmap(nf => NF.generalize(nf, ctx)),
			);
		}),
		M.bind("term", ({ inferred, ty, subst }) => {
			return F.pipe(
				EB.zonk("term", inferred.stmt.value, subst),
				M.fmap(EB.Icit.generalize),
				M.fmap(tm => EB.Icit.wrapLambda(tm, ty)),
			);
		}),
	);

	const [result] = M.run(inference, ctx);
	const e = E.Functor.map(result, ({ term, ty, inferred: { us } }): [EB.AST, EB.Context] => {
		const ast: EB.AST = [term, ty, us];
		return [ast, set(ctx, ["imports", stmt.variable] as const, [term, ty, us])];
	});

	return [stmt.variable, e];
};

export const expression = (stmt: Extract<Src.Statement, { type: "expression" }>, ctx: EB.Context) => {
	const infer = F.pipe(
		EB.infer(stmt.value),
		M.listen(([[tm, ty, us], { constraints }]) => {
			return { inferred: { tm, ty, us }, constraints };
		}),
		M.bind("subst", ({ constraints }) => solve(constraints)),
		M.bind("ty", ({ inferred, subst }) => {
			return F.pipe(
				EB.zonk("nf", inferred.ty, subst),
				M.fmap(nf => NF.generalize(nf, ctx)),
			);
		}),
		M.bind("term", ({ inferred, subst }) => {
			return F.pipe(EB.zonk("term", inferred.tm, subst), M.fmap(EB.Icit.generalize));
		}),
	);

	const [result] = M.run(infer, ctx);
	return E.Functor.map(result, ({ term, ty, inferred: { us } }): EB.AST => {
		const ast: EB.AST = [term, ty, us];
		return ast;
	});
};
