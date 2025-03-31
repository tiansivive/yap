import * as Q from "@yap/shared/modalities/multiplicity";
import * as R from "@yap/shared/rows";
import * as EB from "@yap/elaboration";

import * as Lit from "@yap/shared/literals";
import { Literal } from "@yap/shared/literals";
import { Implicitness } from "@yap/shared/implicitness";

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
	| { type: "Mu"; variable: string; annotation: ModalValue; source: string };

export type Variable =
	| { type: "Bound"; lvl: number }
	| { type: "Free"; name: string }
	| { type: "Label"; name: string }
	| { type: "Foreign"; name: string }
	/**
	 * @see Unification.bind for the reason why we need to store the level
	 */
	| { type: "Meta"; val: number; lvl: number };

export type Closure = {
	ctx: EB.Context;
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
	Mu: (variable: string, source: string, annotation: ModalValue, closure: Closure): Value => ({
		type: "Abs" as const,
		binder: { type: "Mu", variable, annotation, source },
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
	Flex: (variable: { type: "Meta"; val: number; lvl: number }): Value => ({
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
	Closure: (ctx: EB.Context, term: EB.Term): Closure => ({ ctx, term }),

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

export const Indexed: Value = {
	type: "Var",
	variable: { type: "Foreign", name: "Indexed" },
};

export const Patterns = {
	Var: { type: "Var" } as const,
	Rigid: { type: "Var", variable: { type: "Bound" } } as const,
	Flex: { type: "Var", variable: { type: "Meta" } } as const,
	Free: { type: "Var", variable: { type: "Free" } } as const,
	Label: { type: "Var", variable: { type: "Label" } } as const,

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

	HashMap: {
		type: "Neutral",
		value: {
			type: "App",
			icit: "Implicit",
			func: {
				type: "App",
				func: {
					type: "App",
					func: {
						type: "Var",
						variable: { type: "Foreign", name: "Indexed" },
					},
					arg: { type: "Lit", value: { type: "Atom", value: "String" } },
				},
			},
		},
	} as const,
	Array: {
		type: "App",
		func: {
			type: "App",
			func: { type: "Lit", value: { type: "Atom", value: "Indexed" } },
			arg: { type: "Lit", value: { type: "Atom", value: "Num" } },
		},
	} as const,
};
