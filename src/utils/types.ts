export type Extend<T, Brand extends symbol, Metadata> = [RecursiveExtend<T, Brand, Metadata>, Metadata];

type RecursiveExtend<T, Brand extends symbol, Metadata> = T extends object
	? {
			[K in keyof T]: T[K] extends { [S in Brand]: void } ? [RecursiveExtend<T[K], Brand, Metadata>, Metadata] : RecursiveExtend<T[K], Brand, Metadata>;
		}
	: T;

export type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};

export type Tag<Str extends string, T> = T & { __tag: Str };

export type SetProp<P extends string, V, T extends object> = (P extends `${infer K}.${infer Tail}`
	? K extends `${infer KK}[${infer I extends number}]`
		? { [key in KK]: { [key in I]: SetProp<Tail, V, {}> } }
		: { [key in K]: SetProp<Tail, V, {}> }
	: P extends string
		? { [key in P]: V }
		: never) &
	T;

/**
 * Type utility to force typescript to early evaluate the type.
 * This is useful for clarifying type computations
 */
export type Expand<T> = T extends unknown ? { [K in keyof T]: T[K] } : never;

export type Tags<T, K> = K extends string ? (T extends { [k in K]: infer U } ? U : never) : never;

export type Brand<S extends symbol, T> = T & { [K in S]: void };
export const make = <T, S extends symbol>(s: S, a: T): Brand<S, T> => {
	return Object.defineProperty(a, s, { value: void 0 }) as Brand<S, T>;
};
