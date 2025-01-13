const IMPLICITNESS = {
	Implicit: "Implicit",
	Explicit: "Explicit",
} as const;
export type Implicitness = (typeof IMPLICITNESS)[keyof typeof IMPLICITNESS];

const MULTIPLICITY = {
	Zero: "Zero",
	One: "One",
	Many: "Many",
} as const;
export type Multiplicity = (typeof MULTIPLICITY)[keyof typeof MULTIPLICITY];

const LITERAL = {
	Num: (value: number) => ({ type: "Num", value }) as const,
	Bool: (value: boolean) => ({ type: "Bool", value }) as const,
	String: (value: string) => ({ type: "String", value }) as const,
	Unit: () => ({ type: "Unit" }) as const,
	Type: () => ({ type: "Type" }) as const,
	Atom: (value: string) => ({ type: "Atom", value }) as const,
} as const;
export type Literal = ReturnType<(typeof LITERAL)[keyof typeof LITERAL]>;

export default {
	LITERAL,
	...LITERAL,
	MULTIPLICITY,
	...MULTIPLICITY,
	IMPLICITNESS,
	...IMPLICITNESS,
};
