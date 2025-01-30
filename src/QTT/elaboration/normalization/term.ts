import * as Q from "@qtt/shared/modalities/multiplicity";
import * as R from "@qtt/shared/rows";
import * as EB from "@qtt/elaboration";

import * as Lit from "@qtt/shared/literals";
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

export type Row = R.Row<Value, Variable>;

export type Binder = { type: "Pi"; variable: string; annotation: ModalValue; icit: Implicitness } | { type: "Lambda"; variable: string; icit: Implicitness };

export type Variable = { type: "Bound"; index: number } | { type: "Meta"; index: number } | { type: "Free"; name: string };

export type Closure = {
	env: Env;
	term: EB.Term;
};

export type Env = ModalValue[];

export const Constructors = {
	Var: (variable: Variable): Value => ({ type: "Var", variable }),
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
	App: (func: Value, arg: Value, icit: Implicitness) => ({
		type: "App" as const,
		func,
		arg,
		icit,
	}),
	Closure: (env: Env, term: EB.Term): Closure => ({ env, term }),

	Row: (row: Row): Value => ({ type: "Row", row }),
	Extension: (label: string, value: Value, row: Row): Row => ({ type: "extension", label, value, row }),

	Schema: (row: Row): Value => Constructors.Neutral(Constructors.App(Constructors.Lit(Lit.Atom("Schema")), Constructors.Row(row), "Explicit")),
	Variant: (row: Row): Value => Constructors.Neutral(Constructors.App(Constructors.Lit(Lit.Atom("Variant")), Constructors.Row(row), "Explicit")),
};

export const Patterns = {
	Variant: { type: "App", func: { type: "Lit", value: { type: "Atom", value: "Variant" } }, arg: { type: "Row" } } as const,
	Schema: { type: "App", func: { type: "Lit", value: { type: "Atom", value: "Schema" } }, arg: { type: "Row" } } as const,
	Type: { type: "Lit", value: { type: "Atom", value: "Type" } } as const,
	Row: { type: "Lit", value: { type: "Atom", value: "Row" } } as const,
};

export const Type: Value = {
	type: "Lit",
	value: { type: "Atom", value: "Type" },
};

export const Row: Value = {
	type: "Lit",
	value: { type: "Atom", value: "Row" },
};
