export const Patterns = {
	Terms: {
		Struct: { type: "struct" } as const,
	},
	Rows: {
		Empty: { type: "empty" } as const,
		Extension: { type: "extension" } as const,
		Variable: { type: "variable" } as const,
	},
};
