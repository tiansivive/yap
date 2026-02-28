import { P } from "ts-pattern";

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

/** Const pattern objects for ts-pattern `.with()`. Grouped by logical unit. */
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

	Vars: {
		Bound: { type: "Var" as const, variable: { type: "Bound" as const } } as const,
		Free: { type: "Var" as const, variable: { type: "Free" as const } } as const,
		Foreign: { type: "Var" as const, variable: { type: "Foreign" as const } } as const,
	},

	Lambda: { type: "Abs" as const, binding: { type: "Lambda" as const } } as const,

	// R.Row (row structure)
	Rows: {
		Extension: { type: "extension" as const } as const,
		Variable: { type: "variable" as const } as const,
		Empty: { type: "empty" as const } as const,
	},

	// EB.Pattern
	Pats: {
		Variant: { type: "Variant" as const, row: { type: "extension" as const } } as const,
		Struct: { type: "Struct" as const, row: { type: "extension" as const } } as const,
		List: { type: "List" as const } as const,
		Lit: { type: "Lit" as const } as const,
		Binder: { type: "Binder" as const } as const,
		Wildcard: { type: "Wildcard" as const } as const,
	},
} as const;
