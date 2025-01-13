import { match } from "ts-pattern";
import { Implicitness, Literal, Multiplicity } from "../shared";
import { ModalTerm } from "./syntax";

import * as El from "./syntax";

import Shared from "../shared";
import { Extend, Tag } from "../../utils/types";

// export type ModalValue = Extend<Value, Value, Multiplicity>
export type ModalValue = [Value, Multiplicity];

export type Value =
	| { type: "Lit"; value: Literal }
	| { type: "App"; func: Value; arg: Value }
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

// export const Rigid = (index: number, quantity: Multiplicity): ModalValue => ({ type: "Quantity", multiplicity: quantity, value: { type: "Neutral", variable: { type: "Bound", index } } })
// export const Flex = (meta: number, quantity: Multiplicity): ModalValue => ({ type: "Quantity", multiplicity: quantity, value: { type: "Neutral", variable: { type: "Meta", index: meta } } })

// export const NeutralM = (variable: Variable, multiplicity: Multiplicity = "Many"): ModalValue => ({ type: "Quantity", multiplicity, value: { type: "Neutral", variable } })

// export const LitM = (value: Literal, multiplicity: Multiplicity = "Many"): ModalValue => ({ type: "Quantity", multiplicity, value: { type: "Lit", value } })
// export const VarM = (variable: Variable, multiplicity: Multiplicity = "Many"): ModalValue => ({ type: "Quantity", multiplicity, value: { type: "Neutral", variable } })
// export const AppM = (func: ModalValue, arg: ModalValue, multiplicity: Multiplicity = "Many"): ModalValue => ({ type: "Quantity", multiplicity, value: { type: "App", func, arg } })
// export const AbsM = (binder: Binder, closure: Closure, multiplicity: Multiplicity = "Many"): ModalValue => ({ type: "Quantity", multiplicity, value: { type: "Abs", binder, closure } })

// export const PiM = (variable: string, icit: Implicitness, annotation: ModalValue, closure: Closure, multiplicity: Multiplicity = "Many"): ModalValue =>
//     ({ type: "Quantity", multiplicity, value: { type: "Abs", binder: { type: "Pi", variable, annotation, icit }, closure } })

export const Type: ModalValue = [
	{ type: "Lit", value: Shared.Type() },
	Shared.Zero,
];

export const Closure = (env: Env, term: El.Term): Closure => ({ env, term });

export const quote = (lvl: number, mv: ModalValue): El.Term => {
	const [value, quantity] = mv;
	return (
		match(value)
			.with({ type: "Lit" }, ({ value }) => El.Lit(value))
			// .with({ type: "App" }, ({ func, arg }) => El.AppM("Explicit", quote(func), quote(arg), mv.multiplicity))
			.otherwise(() => {
				throw new Error("Quoting: Not implemented");
			})
	);
};

export const infer = (env: Env, value: Value): ModalValue =>
	match(value)
		.with({ type: "Lit" }, (ty): ModalValue => [ty, Shared.Many])
		.otherwise(() => {
			return [value, Shared.Many];
		});
