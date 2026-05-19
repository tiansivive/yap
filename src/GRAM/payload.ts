import type { Payload } from "./graph";

export const string = (p: Payload, key: string): string => {
	const v = p[key];

	if (typeof v !== "string") {
		throw new Error(`payload.${key}: expected string, got ${typeof v}`);
	}
	return v;
};

export const number = (p: Payload, key: string): number => {
	const v = p[key];

	if (typeof v !== "number") {
		throw new Error(`payload.${key}: expected number, got ${typeof v}`);
	}
	return v;
};

export const boolean = (p: Payload, key: string): boolean => {
	const v = p[key];

	if (typeof v !== "boolean") {
		throw new Error(`payload.${key}: expected boolean, got ${typeof v}`);
	}
	return v;
};
