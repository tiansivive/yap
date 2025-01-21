import { zipWith } from "fp-ts/lib/Array";
import type { Multiplicity } from "../shared";
import { Semiring } from "fp-ts/lib/Semiring";
import { match, P } from "ts-pattern";
import _ from "lodash";

export type Usages = Multiplicity[];

export const SR: Semiring<Multiplicity> = {
	zero: "Zero",
	one: "One",
	add(x, y) {
		return match([x, y])
			.with(["Many", P._], [P._, "Many"], (): Multiplicity => "Many")
			.with(["One", "One"], (): Multiplicity => "Many")
			.with(["One", P._], [P._, "One"], (): Multiplicity => "One")
			.otherwise(() => "Zero");
	},
	mul(x, y) {
		return match([x, y])
			.with(["Zero", P._], [P._, "Zero"], (): Multiplicity => "Zero")
			.with(["One", P._], ([, m]) => m)
			.with([P._, "One"], ([m]) => m)
			.otherwise(() => "One");
	},
};

export const noUsage = (lvl: number): Multiplicity[] => Array(lvl).fill("Zero");

export const multiply = (q: Multiplicity, usages: Usages) =>
	usages.map((u) => SR.mul(q, u));
export const add = (u1: Usages, u2: Usages) => {
	// if (u1.length !== u2.length) throw new Error("Mismatched usage lengths")

	return _.zipWith(u1, u2, (a = "Zero", b = "Zero") => SR.add(a, b));
};
