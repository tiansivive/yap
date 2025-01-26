import { replicate, unsafeUpdateAt } from "fp-ts/lib/Array";
import * as NF from "./normalization";
import * as ED from "./index";
import * as Q from "@qtt/shared/modalities/multiplicity";

import * as Src from "@qtt/src/index";

type Origin = "inserted" | "source";

export type Context = {
	types: Array<[String, Origin, NF.ModalValue]>;
	env: NF.Env;
	names: Array<String>;
	imports: Record<string, AST>;
};

export type AST = [ED.Term, NF.Value, Q.Usages];

export const lookup = (variable: Src.Variable, ctx: Context): AST => {
	const _lookup = (i: number, variable: Src.Variable, types: Context["types"]): AST => {
		const zeros = replicate<Q.Multiplicity>(ctx.env.length, Q.Zero);
		if (types.length === 0) {
			const free = ctx.imports[variable.value];
			if (free) {
				const [, nf, us] = free;
				return [ED.Constructors.Var({ type: "Free", name: variable.value }), nf, Q.add(us, zeros)];
			}

			throw new Error("Variable not found");
		}

		const [[name, origin, [nf, m]], ...rest] = types;
		const usages = unsafeUpdateAt(i, m, zeros);
		if (name === variable.value && origin === "source") {
			return [ED.Constructors.Var({ type: "Bound", index: i }), nf, usages];
		}

		return _lookup(i + 1, variable, rest);
	};

	return _lookup(0, variable, ctx.types);
};

export const bind = (context: Context, variable: string, annotation: NF.ModalValue): Context => {
	const [, q] = annotation;
	const { env, types } = context;
	return {
		...context,
		env: [[NF.Constructors.Rigid(env.length), q], ...env],
		types: [[variable, "source", annotation], ...types],
		names: [variable, ...context.names],
	};
};

export const bindInsertedImplicit = (context: Context, variable: string, annotation: NF.ModalValue): Context => {
	const [, q] = annotation;
	const { env, types } = context;
	return {
		...context,
		env: [[NF.Constructors.Rigid(env.length), q], ...env],
		types: [[variable, "inserted", annotation], ...types],
		names: [variable, ...context.names],
	};
};
