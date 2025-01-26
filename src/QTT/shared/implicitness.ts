const IMPLICITNESS = {
	Implicit: "Implicit",
	Explicit: "Explicit",
} as const;
export const { Implicit, Explicit } = IMPLICITNESS;
export type Implicitness = (typeof IMPLICITNESS)[keyof typeof IMPLICITNESS];

export const display = (icit: Implicitness): string => {
	return icit === "Implicit" ? "#" : "";
};
