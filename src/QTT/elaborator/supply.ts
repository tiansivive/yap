import * as El from "./syntax";

let count = 0;

export const freshMeta = (): El.Variable => {
	count++;
	return El.Meta(count);
};
