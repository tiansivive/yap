const LITERAL = {
	Num: (value: number) => ({ type: "Num", value }) as const,
	Bool: (value: boolean) => ({ type: "Bool", value }) as const,
	String: (value: string) => ({ type: "String", value }) as const,
	Unit: () => ({ type: "Atom", value: "Unit" }) as const,
	Type: () => ({ type: "Atom", value: "Type" }) as const,
	Row: () => ({ type: "Atom", value: "Row" }) as const,
	Atom: (value: string) => ({ type: "Atom", value }) as const,
} as const;
export const { Num, Bool, String, Unit, Type, Row, Atom } = LITERAL;
export type Literal = ReturnType<(typeof LITERAL)[keyof typeof LITERAL]>;

export const display = (lit: Literal): string => {
	switch (lit.type) {
		case "String":
			return `"${lit.value}"`;
		case "Num":
			return `${lit.value}`;
		case "Bool":
			return `${lit.value}`;
		case "Atom":
			return lit.value;
		case "Atom":
			return lit.value;
	}
};
