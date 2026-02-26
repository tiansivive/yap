import { P } from "ts-pattern";

/** Const pattern objects for ts-pattern `.with()`. Follow elaboration style (NF.Patterns, EB.CtorPatterns). */

const TypeLevelSchema = {
	type: "App" as const,
	func: { type: "Lit" as const, value: { type: "Atom" as const, value: "Schema" } },
	arg: { type: "Row" as const },
} as const;

const TypeLevelVariant = {
	type: "App" as const,
	func: { type: "Lit" as const, value: { type: "Atom" as const, value: "Variant" } },
	arg: { type: "Row" as const },
} as const;

const TypeLevelArray = {
	type: "App" as const,
	func: { type: "Lit" as const, value: { type: "Atom" as const, value: "Array" } },
	arg: { type: "Row" as const },
} as const;

export const Patterns = {
	// EB.Term
	Proj: { type: "Proj" } as const,
	Inj: { type: "Inj" } as const,
	Row: { type: "Row" } as const,
	Lit: { type: "Lit" } as const,
	App: { type: "App" } as const,

	StructApp: {
		type: "App" as const,
		func: { type: "Lit" as const, value: { type: "Atom" as const, value: "Struct" } },
		arg: { type: "Row" as const },
	},

	TypeLevelApp: P.union(TypeLevelSchema, TypeLevelVariant, TypeLevelArray),

	VarBound: { type: "Var" as const, variable: { type: "Bound" as const } } as const,
	VarFree: { type: "Var" as const, variable: { type: "Free" as const } } as const,
	VarForeign: { type: "Var" as const, variable: { type: "Foreign" as const } } as const,

	// EB.Row (R.Row)
	Extension: { type: "extension" as const } as const,
	Variable: { type: "variable" as const } as const,
	Empty: { type: "empty" as const } as const,
} as const;
