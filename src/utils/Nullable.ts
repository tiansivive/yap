export type Nullable<A> = A | undefined;

export function map<A, B>(fa: Nullable<A>, f: (a: A) => B): Nullable<B>;
export function map<A, B>(f: (a: A) => B): (fa: Nullable<A>) => Nullable<B>;
export function map<A, B>(
	...args: [Nullable<A>, (a: A) => B] | [(a: A) => B]
): Nullable<B> | ((fa: Nullable<A>) => Nullable<B>) {
	if (args.length === 1) {
		const [f] = args;
		return (fa) => (fa === undefined ? undefined : f(fa));
	}

	const [fa, f] = args;
	return fa === undefined ? undefined : f(fa);
}
