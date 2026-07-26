import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";

const counts = {
	meta: 0,
	var: 0,
	skolem: 0,
};

export const resetSupply = (key: keyof typeof counts) => {
	counts[key] = 0;
};

export const freshMeta = function* (lvl: number, ann: EB.NF.Value) {
	counts.meta++;

	const m: EB.Meta = { type: "Meta", val: counts.meta, lvl };
	const ctx = yield* V2.ask();
	yield* V2.tell("meta", { meta: m, ann: EB.NF.quote(ctx, lvl, ann) });

	return m;
};

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
