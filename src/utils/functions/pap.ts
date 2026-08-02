/* eslint-disable no-restricted-syntax */
export const __: unique symbol = Symbol("pap.hole");
export type Hole = typeof __;

type Bindings<Params extends readonly unknown[]> = {
	[K in keyof Params]?: Params[K] | Hole;
};

type Remaining<Params extends readonly unknown[], Bound extends readonly unknown[]> = Bound extends readonly [infer BoundHead, ...infer BoundTail]
	? Params extends readonly [infer ParamHead, ...infer ParamTail]
		? BoundHead extends Hole
			? [ParamHead, ...Remaining<ParamTail, BoundTail>]
			: Remaining<ParamTail, BoundTail>
		: []
	: [...Params];

export function pap<const Params extends readonly unknown[], Result, const Bound extends Bindings<Params>>(
	fn: (...args: Params) => Result,
	...bound: Bound
): (...rest: Remaining<Params, Bound>) => Result {
	return (...rest) => {
		const args: unknown[] = [];

		let restIndex = 0;
		for (const value of bound) {
			args.push(value === __ ? rest[restIndex++] : value);
		}

		args.push(...rest.slice(restIndex));

		// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
		return fn(...(args as unknown as Params));
	};
}
