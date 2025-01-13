import { match, P } from "ts-pattern";
import { Term } from "./terms.js";
import { infer } from "./typechecking/infer.js";

export const isValue: (t: Term) => boolean = (t) =>
	match(t)
		.with({ tag: "Lit" }, () => true)
		.with({ tag: "Neutral" }, () => true)
		.with({ tag: "Abs", binder: { tag: "Let" } }, () => false)
		.with({ tag: "Abs", body: P.when(isValue) }, () => true)
		.otherwise(() => false);

export const isType = (t: Term) => {
	return t.tag === "Lit" && t.value.tag === "Type";
};

export const betaReduce: any = () => {
	throw "Beta Reduce: Not implemented";
};

export type Error<T> = { message: string; value: T };

export const error = <T>(message: string, value: T): Error<T> => ({
	message,
	value,
});
