import * as Q from "@qtt/shared/modalities/multiplicity";
import * as EB from "@qtt/elaboration";

import { Literal } from "@qtt/shared/literals";
import { Implicitness } from "@qtt/shared/implicitness";

export type ModalValue = [Value, Q.Multiplicity];

export type Value =
	| { type: "Var"; variable: Variable }
	| { type: "Lit"; value: Literal }
	| { type: "App"; func: Value; arg: Value; icit: Implicitness }
	| { type: "Row"; row: Row }
	| { type: "Abs"; binder: Binder; closure: Closure }
	| { type: "Neutral"; value: Value };

export type Row = { type: "Empty" } | { type: "Extension"; label: string; value: Value; row: Row } | { type: "Variable"; variable: Variable };

export type Binder = { type: "Pi"; variable: string; annotation: ModalValue; icit: Implicitness } | { type: "Lambda"; variable: string; icit: Implicitness };

type Variable = { type: "Bound"; index: number } | { type: "Meta"; index: number } | { type: "Free"; name: string };

export type Closure = {
	env: Env;
	term: EB.Term;
};

export type Env = ModalValue[];

export const Type: Value = {
	type: "Lit",
	value: { type: "Atom", value: "Type" },
};

export const Closure = (env: Env, term: EB.Term): Closure => ({ env, term });

export const Constructors = {
	Pi: <A, B>(variable: string, icit: Implicitness, annotation: A, closure: B) => ({
		type: "Abs" as const,
		binder: { type: "Pi" as const, variable, icit, annotation },
		closure,
	}),
	Lambda: <A>(variable: string, icit: Implicitness, closure: A) => ({
		type: "Abs" as const,
		binder: { type: "Lambda" as const, variable, icit },
		closure,
	}),
	Rigid: (lvl: number) => ({
		type: "Neutral" as const,
		value: {
			type: "Var" as const,
			variable: { type: "Bound" as const, index: lvl },
		},
	}),
	Lit: (value: Literal) => ({
		type: "Lit" as const,
		value,
	}),
	Neutral: <T>(value: T) => ({
		type: "Neutral" as const,
		value,
	}),
	App: <A, B>(func: A, arg: B, icit: Implicitness) => ({
		type: "App" as const,
		func,
		arg,
		icit,
	}),
};
