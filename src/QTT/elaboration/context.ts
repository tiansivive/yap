import { replicate, unsafeUpdateAt } from "fp-ts/lib/Array";
import * as NF from "./normalization";
import * as EB from "./index";
import * as Q from "@qtt/shared/modalities/multiplicity";

import { M } from "@qtt/elaboration";

import * as Src from "@qtt/src/index";
import * as P from "@qtt/shared/provenance";

type Origin = "inserted" | "source";

export type Context = {
	types: Array<[Binder, Origin, NF.ModalValue]>;
	env: NF.Env;
	names: Array<Binder>;
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

type Metadata = {
	action: string;
	motive?: string;
} & Record<string, unknown>;

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
		if (binder.variable === variable.value && origin === "source") {
			const tm = EB.Constructors.Var({ type: "Bound", index: i });
			return M.fmap(M.tell("binder", binder), _ => [tm, nf, usages]);
		}

		return _lookup(i + 1, variable, rest);
	};

	return _lookup(0, variable, ctx.types);
};

export const bind = (context: Context, binder: Binder, annotation: NF.ModalValue, origin: Origin = "source"): Context => {
	const [, q] = annotation;
	const { env, types } = context;
	return {
		...context,
		env: [[NF.Constructors.Rigid(env.length), q], ...env],
		types: [[binder, "source", annotation], ...types],
		names: [binder, ...context.names],
	};
};

export const muContext = (ctx: Context): Context => {
	const muIdxs = ctx.types.reduce((acc, [b], i) => {
		if (b.type === "Let") {
			return [...acc, i];
		}
		return acc;
	}, [] as number[]);

	const reorder = <T>(arr: T[], indices: number[]): T[] => {
		const front = indices.map(i => arr[i]);
		const rest = arr.filter((_, i) => !indices.includes(i));
		return [...front, ...rest];
	};

	// return {
	// 	...ctx,
	// 	types: reorder(ctx.types, muIdxs).map(([b, ...rest]) => {
	// 		if (b.type === "Let") return [{ ...b, type: "Mu" }, ...rest];

	// 		return [b, ...rest];
	// 	}),
	// 	env: reorder(ctx.env, muIdxs),
	// 	names: reorder(ctx.names, muIdxs),
	// }

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
