import * as F from "fp-ts/lib/function";

type Cont<R, A> = {
	run: (k: (a: A) => R) => R;
};
const Cont = <R, A>(run: (k: (a: A) => R) => R): Cont<R, A> => ({ run });

function bind<R, A, B>(m: Cont<R, A>, f: (a: A) => Cont<R, B>): Cont<R, B> {
	return Cont(k => m.run(v => f(v).run(k)));
}

function of<R, A>(a: A): Cont<R, A> {
	return Cont(k => k(a));
}

function fmap<R, A, B>({ run }: Cont<R, A>, f: (a: A) => B): Cont<R, B> {
	return Cont(k => run(a => k(f(a))));
}

const pure = of;
function apply<R, A, B>(m: Cont<R, (a: A) => B>, a: Cont<R, A>): Cont<R, B> {
	return bind(m, f => fmap(a, f));
}

function runC<W>(cont: Cont<W, W>): W {
	return cont.run(k => k);
}

function reset<W, A>(cont: Cont<A, A>): Cont<W, A> {
	return F.pipe(cont, runC, of<W, A>);
}

function shift<W, A>(f: (k: (a: A) => W) => Cont<W, W>): Cont<W, A> {
	return Cont(F.flow(f, runC));
}

export const liftM2: <A, B, C>(f: (a: A) => (b: B) => C) => <R>(ma: Cont<R, A>) => (mb: Cont<R, B>) => Cont<R, C> = f => ma => mb => {
	const lifted = of<any, typeof f>(f);
	const appliedA = apply(lifted, ma);
	const appliedB = apply(appliedA, mb);
	return appliedB;
};
