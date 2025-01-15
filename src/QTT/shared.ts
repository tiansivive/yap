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
	Unit: () => ({ type: "Atom", value: "Unit" }) as const,
	Type: () => ({ type: "Atom", value: "Type" }) as const,
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

export const displayLit = (lit: Literal): string => {
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

export const displayIcit = (icit: Implicitness): string => {
	return icit === "Implicit" ? "#" : "";
};
