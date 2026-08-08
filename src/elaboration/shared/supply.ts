import * as Metas from "./metas";

const counts = {
	meta: 0,
	var: 0,
	skolem: 0,
};

export const resetSupply = (key: keyof typeof counts) => {
	counts[key] = 0;
};

/** Mints from the supply effect and registers in the metacontext. */
export const freshMeta = Metas.fresh;

// export const freshSkolem = function* (ann: EB.NF.Value) {
// 	counts.skolem++;

// 	const s = { type: "Skolem", val: counts.skolem, name: `s${counts.skolem}` } as const;
// 	yield* V2.tell("skolem", { skolem: s, ann });

// 	return s;
// };

export const nextCount = () => {
	counts.var++;
	return counts.var;
};
