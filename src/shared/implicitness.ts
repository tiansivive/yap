import { match } from "ts-pattern";

const IMPLICITNESS = {
	Implicit: "Implicit",
	Explicit: "Explicit",
} as const;
export const { Implicit, Explicit } = IMPLICITNESS;
export type Implicitness = (typeof IMPLICITNESS)[keyof typeof IMPLICITNESS];

export type Elimination = Implicitness | "Psi" | "Phi";

export const display = (icit: Elimination): string =>
	match(icit)
		.with("Explicit", () => "")
		.with("Implicit", () => "@")
		.with("Psi", () => "ψ")
		.with("Phi", () => "φ")
		.exhaustive();
