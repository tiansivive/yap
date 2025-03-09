import { replicate, unsafeUpdateAt } from "fp-ts/lib/Array";
import * as NF from "./normalization";
import * as EB from "./index";
import * as Q from "@qtt/shared/modalities/multiplicity";

import { M } from "@qtt/elaboration";

import * as Src from "@qtt/src/index";
import * as P from "@qtt/shared/provenance";

import * as U from "./unification";
import * as Sub from "./substitution";

import * as E from "fp-ts/Either";

type Origin = "inserted" | "source";

export type Context = {
	types: Array<[Binder, Origin, NF.ModalValue]>;
	env: NF.Env;
	names: Array<Binder>;
	implicits: Array<[EB.Term, NF.Value]>;
	imports: Record<string, AST>;
	trace: P.Stack<Provenance>;
};

export type AST = [EB.Term, NF.Value, Q.Usages];

export type Provenance =
	| ["src", Src.Term, Metadata?]
	| ["eb", EB.Term, Metadata?]
	| ["nf", NF.Value, Metadata?]
	| ["alt", Src.Alternative, Metadata?]
	| ["unify", [NF.Value, NF.Value], Metadata?];

type Metadata =
	| { action: "checking"; against: NF.Value }
	| { action: "infer" }
	| { action: "unification" }
	| { action: "alternative"; type: NF.Value; motive: string };

export type Binder = Pick<EB.Binding, "type" | "variable">;

export const lookup = (variable: Src.Variable, ctx: Context): M.Elaboration<AST> => {
	const _lookup = (i: number, variable: Src.Variable, types: Context["types"]): M.Elaboration<AST> => {
		const zeros = replicate<Q.Multiplicity>(ctx.env.length, Q.Zero);
		if (types.length === 0) {
			const free = ctx.imports[variable.value];
			if (free) {
				const [, nf, us] = free;

				const tm = EB.Constructors.Var({ type: "Free", name: variable.value });
				return M.of<AST>([tm, nf, Q.add(us, zeros)]);
			}

			throw new Error(`Variable not found: ${variable.value}`);
		}

		const [[binder, origin, [nf, m]], ...rest] = types;
		const usages = unsafeUpdateAt(i, m, zeros);
		// do we need to check origin here? I don't think it makes a difference whether it's an inserted (implicit) or source (explicit) binder
		if (binder.variable === variable.value) {
			const tm = EB.Constructors.Var({ type: "Bound", index: i });
			return M.fmap(M.tell("binder", binder), _ => [tm, nf, usages]);
		}

		return _lookup(i + 1, variable, rest);
	};

	return _lookup(0, variable, ctx.types);
};

export const resolveImplicit = (nf: NF.Value): M.Elaboration<[EB.Term, Sub.Subst] | void> => {
	return M.fmap(M.ask(), ctx => {
		const lookup = (implicits: Context["implicits"]): [EB.Term, Sub.Subst] | void => {
			if (implicits.length === 0) {
				return;
			}

			const [[term, value], ...rest] = implicits;
			const [result] = M.run(U.unify(nf, value, ctx.env.length, {}), ctx);

			if (E.isRight(result)) {
				return [term, result.right];
			}
			return lookup(rest);
		};

		return lookup(ctx.implicits);
	});
};

export const bind = (context: Context, binder: Binder, annotation: NF.ModalValue, origin: Origin = "source"): Context => {
	const [, q] = annotation;
	const { env, types } = context;
	return {
		...context,
		env: [[NF.Constructors.Rigid(env.length), q], ...env],
		types: [[binder, origin, annotation], ...types],
		names: [binder, ...context.names],
	};
};

export const muContext = (ctx: Context): Context => {
	return {
		...ctx,
		types: ctx.types.map(([b, ...rest]) => {
			if (b.type === "Let") {
				return [{ ...b, type: "Mu" }, ...rest];
			}
			return [b, ...rest];
		}),
	};
};
