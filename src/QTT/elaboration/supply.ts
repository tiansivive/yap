import * as EB from "@qtt/elaboration";

const counts = {
	meta: 0,
	var: 0,
};

export const resetSupply = (key: keyof typeof counts) => {
	counts[key] = 0;
};

export const freshMeta = (): EB.Variable => {
	counts.meta++;
	return EB.Meta(counts.meta);
};

export const getVarCount = () => {
	counts.var++;
	return counts.var;
};
