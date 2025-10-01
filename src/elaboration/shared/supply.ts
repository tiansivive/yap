import * as EB from "@yap/elaboration";

const counts = {
	meta: 0,
	var: 0,
};

export const resetSupply = (key: keyof typeof counts) => {
	counts[key] = 0;
};

export function freshMeta(lvl: number, ann: EB.NF.Value): Extract<EB.Variable, { type: "Meta" }> {
	counts.meta++;

	return { type: "Meta", val: counts.meta, lvl };
}

export const nextCount = () => {
	counts.var++;
	return counts.var;
};
