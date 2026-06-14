// Shared IVL patterns keep solver structural dispatch explicit and reusable.

export const Patterns = {
	Formula: {
		True: { tag: "True" } as const,
		False: { tag: "False" } as const,
		Atom: { tag: "Atom" } as const,
		Not: { tag: "Not" } as const,
		And: { tag: "And" } as const,
		Or: { tag: "Or" } as const,
		Implies: { tag: "Implies" } as const,
		Forall: { tag: "Forall" } as const,
		Exists: { tag: "Exists" } as const,
	},
	Term: {
		Var: { tag: "Var" } as const,
		Const: { tag: "Const" } as const,
		Num: { tag: "Num" } as const,
		Bool: { tag: "Bool" } as const,
		Str: { tag: "Str" } as const,
		Arith: { tag: "Arith" } as const,
		App: { tag: "App" } as const,
		Select: { tag: "Select" } as const,
		Row: { tag: "Row" } as const,
	},
	Sort: {
		Bool: { tag: "Bool" } as const,
		Int: { tag: "Int" } as const,
		Real: { tag: "Real" } as const,
		String: { tag: "String" } as const,
		Unit: { tag: "Unit" } as const,
		Row: { tag: "Row" } as const,
		Fn: { tag: "Fn" } as const,
		Uninterpreted: { tag: "Uninterpreted" } as const,
	},
} as const;
