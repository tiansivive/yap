export type Extend<T, Base, Metadata> = [
	RecursiveExtend<T, Base, Metadata>,
	Metadata,
];

type RecursiveExtend<T, Base, Metadata> = T extends object
	? {
			[K in keyof T]: T[K] extends Base
				? [RecursiveExtend<T[K], Base, Metadata>, Metadata]
				: RecursiveExtend<T[K], Base, Metadata>;
		}
	: T;

export type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};

export type Tag<Str extends string, T> = T & { __tag: Str };
