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

export type Binder =
	| { type: "Pi"; variable: string; annotation: ModalValue; icit: Implicitness }
	| { type: "Lambda"; variable: string; icit: Implicitness }
	| { type: "Mu"; variable: string; annotation: ModalValue };

export type Variable = { type: "Bound"; lvl: number } | { type: "Meta"; val: number } | { type: "Free"; name: string };

export type Closure = {
	env: Env;
	term: EB.Term;
};

export type Env = ModalValue[];

export const Constructors = {
	Var: (variable: Variable): Value => ({ type: "Var", variable }),
	Pi: (variable: string, icit: Implicitness, annotation: ModalValue, closure: Closure) => ({
		type: "Abs" as const,
		binder: { type: "Pi" as const, variable, icit, annotation },
		closure,
	}),
	Mu: (variable: string, annotation: ModalValue, closure: Closure) => ({
		type: "Abs" as const,
		binder: { type: "Mu" as const, variable, annotation },
		closure,
	}),
	Lambda: (variable: string, icit: Implicitness, closure: Closure) => ({
		type: "Abs" as const,
		binder: { type: "Lambda" as const, variable, icit },
		closure,
	}),
	Rigid: (lvl: number): Value => ({
		type: "Neutral",
		value: {
			type: "Var" as const,
			variable: { type: "Bound", lvl },
		},
	}),
	Flex: (variable: { type: "Meta"; val: number }): Value => ({
		type: "Neutral",
		value: { type: "Var", variable },
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

export const Type: Value = {
	type: "Lit",
	value: { type: "Atom", value: "Type" },
};

export const Row: Value = {
	type: "Lit",
	value: { type: "Atom", value: "Row" },
};

export const Patterns = {
	Var: { type: "Var" } as const,
	Rigid: { type: "Var", variable: { type: "Bound" } } as const,
	Flex: { type: "Var", variable: { type: "Meta" } } as const,
	Free: { type: "Var", variable: { type: "Free" } } as const,

	Lit: { type: "Lit" } as const,
	Atom: { type: "Lit", value: { type: "Atom" } } as const,
	Type: { type: "Lit", value: { type: "Atom", value: "Type" } } as const,
	Unit: { type: "Lit", value: { type: "Atom", value: "Unit" } } as const,

	Variant: { type: "App", func: { type: "Lit", value: { type: "Atom", value: "Variant" } }, arg: { type: "Row" } } as const,
	Schema: { type: "App", func: { type: "Lit", value: { type: "Atom", value: "Schema" } }, arg: { type: "Row" } } as const,

	App: { type: "App" } as const,
	Pi: { type: "Abs", binder: { type: "Pi" } } as const,
	Lambda: { type: "Abs", binder: { type: "Lambda" } } as const,
	Mu: { type: "Abs", binder: { type: "Mu" } } as const,
	Row: { type: "Row" } as const,
};
