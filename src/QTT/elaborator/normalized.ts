import { match } from "ts-pattern";
import { Implicitness, Literal, Multiplicity } from "../shared";

import * as El from "./syntax";

import Shared from "../shared";
import * as Eval from "./evaluator";
import * as Con from "./constructors";
import * as Elab from "./elaborate";

export type ModalValue = [Value, Multiplicity];

export type Value =
	| { type: "Lit"; value: Literal }
	| { type: "App"; func: Value; arg: Value; icit: Implicitness }
	| { type: "Abs"; binder: Binder; closure: Closure }
	| { type: "Neutral"; variable: Variable };

export type Binder =
	| { type: "Pi"; variable: string; annotation: ModalValue; icit: Implicitness }
	| { type: "Lambda"; variable: string; icit: Implicitness };

type Variable =
	| { type: "Bound"; index: number }
	| { type: "Meta"; index: number }
	| { type: "Free"; name: string };

export type Closure = {
	env: Env;
	term: El.Term;
};

export type Env = ModalValue[];

export const Type: ModalValue = [
	{ type: "Lit", value: { type: "Atom", value: "Type" } },
	Shared.Zero,
];

export const Closure = (env: Env, term: El.Term): Closure => ({ env, term });

export const quote = (
	imports: Elab.Context["imports"],
	lvl: number,
	val: Value,
): El.Term => {
	return match(val)
		.with({ type: "Lit" }, ({ value }) => El.Lit(value))
		.with({ type: "Neutral", variable: { type: "Bound" } }, ({ variable }) =>
			El.Var({ type: "Bound", index: lvl - variable.index - 1 }),
		)
		.with({ type: "Neutral" }, ({ variable }) => El.Var(variable))
		.with({ type: "App" }, ({ func, arg, icit }) =>
			El.App(icit, quote(imports, lvl, func), quote(imports, lvl, arg)),
		)
		.with(
			{ type: "Abs", binder: { type: "Lambda" } },
			({ binder, closure }) => {
				const { variable, icit } = binder;
				const val = Eval.apply(imports, closure, Con.Type.Rigid(lvl));
				const body = quote(imports, lvl + 1, val);
				return Con.Term.Lambda(variable, icit, body);
			},
		)
		.with({ type: "Abs", binder: { type: "Pi" } }, ({ binder, closure }) => {
			const {
				variable,
				icit,
				annotation: [ann],
			} = binder;
			const val = Eval.apply(imports, closure, Con.Type.Rigid(lvl));
			const body = quote(imports, lvl + 1, val);
			return Con.Term.Pi(variable, icit, quote(imports, lvl, ann), body);
		})
		.exhaustive();
};

export const infer = (env: Env, value: Value): ModalValue =>
	match(value)
		.with({ type: "Lit" }, (ty): ModalValue => {
			let m = match(ty.value)
				.with({ type: "Atom" }, () => Shared.Zero)
				.otherwise(() => Shared.Many);

			return [ty, m];
		})
		.otherwise(() => {
			return [value, Shared.Many];
		});
