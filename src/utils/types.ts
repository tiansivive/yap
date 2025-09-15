export type Extend<T, Base, Metadata> = [RecursiveExtend<T, Base, Metadata>, Metadata];

type RecursiveExtend<T, Base, Metadata> = T extends object
	? {
			[K in keyof T]: T[K] extends Base ? [RecursiveExtend<T[K], Base, Metadata>, Metadata] : RecursiveExtend<T[K], Base, Metadata>;
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
