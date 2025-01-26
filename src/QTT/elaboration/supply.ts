import * as EB from "@qtt/elaboration";

let count = 0;

export const freshMeta = (): EB.Variable => {
	count++;
	return EB.Meta(count);
};
