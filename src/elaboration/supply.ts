import * as EB from "@yap/elaboration";

const counts = {
	meta: 0,
	var: 0,
};

export const resetSupply = (key: keyof typeof counts) => {
	counts[key] = 0;
};

export function freshMeta(): { type: "Meta"; val: number };
export function freshMeta(lvl: number): { type: "Meta"; val: number; lvl: number };
export function freshMeta(lvl?: number) {
	counts.meta++;

	if (lvl === undefined) {
		return { type: "Meta", val: counts.meta };
	}
	return { type: "Meta", val: counts.meta, lvl };
}

export const nextCount = () => {
	counts.var++;
	return counts.var;
};
