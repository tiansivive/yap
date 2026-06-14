/* eslint-disable @typescript-eslint/no-namespace */
// Theory orchestration for v2: registers CNF atoms with concrete theory states.
// CDCL(T) = Conflict-Driven Clause Learning modulo theories; EUF = Equality with Uninterpreted Functions.
// https://github.com/tiansivive/z-yap/blob/main/zettels/theory-plugin-interface.md

import * as E from "fp-ts/Either";
import type { Either } from "fp-ts/lib/Either";
import { match } from "ts-pattern";
import * as Arithmetic from "../arithmetic";
import type { Conflict, Literal } from "../cdcl";
import * as Core from "../core";
import type * as Encoding from "../encoding";
import * as EUF from "../euf";

export type State = {
	readonly euf: EUF.CC.State;
	readonly arithmetic: Arithmetic.State;
};

export const State = {
	empty: {
		euf: EUF.CC.empty,
		arithmetic: Arithmetic.State.empty,
	} satisfies State,
};

export const setup = (encoding: Encoding.State): Setup => {
	const registered = Registration.from(encoding);
	const euf = registered.equalities.reduce((state, equality) => EUF.CC.register(state, equality.literal, equality.equality), EUF.CC.init(registered.arena));
	const arithmetic = registered.arithmetics.reduce<Arithmetic.State>(
		(state, arithmetic) => Arithmetic.State.register(state, arithmetic.literal, arithmetic.atom),
		Arithmetic.State.empty,
	);
	return { arena: registered.arena, state: { ...State.empty, euf, arithmetic }, equalities: registered.equalities, arithmetics: registered.arithmetics };
};

export const install = function* (encoding: Encoding.State): Core.G<Setup> {
	const prepared = setup(encoding);
	yield* Core.State.modify(state => ({ ...state, encoding, arena: prepared.arena, theories: prepared.state }));
	return prepared;
};

export const assert = (state: State, arena: EUF.Arena.State, literal: Literal): Check =>
	E.Monad.chain(EUF.CC.assert(state.euf, arena, literal), euf =>
		E.Functor.map(Arithmetic.State.assert(state.arithmetic, literal), arithmetic => ({
			state: { ...state, euf: euf.state, arithmetic: arithmetic.state },
			propagations: [...euf.propagations, ...arithmetic.propagations],
		})),
	);

export const check = (state: State, arena: EUF.Arena.State): Check =>
	E.Monad.chain(EUF.CC.check(state.euf), euf =>
		E.Functor.map(Arithmetic.State.check(state.arithmetic), arithmetic => ({
			state: { ...state, euf: euf.state, arithmetic: arithmetic.state },
			propagations: [...euf.propagations, ...arithmetic.propagations],
		})),
	);

export const enter = (state: State): State => ({
	...state,
	euf: EUF.CC.push(state.euf),
	arithmetic: Arithmetic.State.push(state.arithmetic),
});

export const backtrack = (state: State): State => ({
	...state,
	euf: EUF.CC.pop(state.euf),
	arithmetic: Arithmetic.State.pop(state.arithmetic),
});

export type Setup = {
	readonly arena: EUF.Arena.State;
	readonly state: State;
	readonly equalities: readonly Equality.Entry[];
	readonly arithmetics: readonly Arithmetic.Entry[];
};

export type Update = {
	readonly state: State;
	readonly propagations: readonly Propagation[];
};

export type Check = Either<Conflict, Update>;

export type Propagation = EUF.Propagation;

export namespace Equality {
	export type Entry = {
		readonly literal: Literal;
		readonly equality: EUF.Equality;
	};
}

export namespace Event {
	export type Local = { tag: "euf"; event: EUF.Event } | { tag: "arithmetic"; event: Arithmetic.Event };

	export type T =
		| { tag: "assert"; theory: string; literal: Literal; result: "ok" | "conflict"; detail: Local[] }
		| { tag: "check"; theory: string; result: "ok" | "conflict"; detail: Local[] }
		| { tag: "enter"; level: number }
		| { tag: "backtrack"; to: number };
}

export type Event = Event.T;

const Registration = {
	from: (encoding: Encoding.State): Registration.State =>
		[...encoding.atoms.entries()].reduce<Registration.State>(
			(acc, [literal, atom]) => {
				const pair = EUF.Intern.pair(acc.arena, atom.args[0], atom.args[1]);
				return {
					arena: pair.state,
					equalities: [...acc.equalities, ...Entries.equality(literal, atom.op, pair.left, pair.right)],
					arithmetics: [...acc.arithmetics, ...Entries.arithmetic(literal, atom)],
				};
			},
			{ arena: EUF.Intern.empty, equalities: [], arithmetics: [] },
		),
};

namespace Registration {
	export type State = {
		readonly arena: EUF.Arena.State;
		readonly equalities: readonly Equality.Entry[];
		readonly arithmetics: readonly Arithmetic.Entry[];
	};
}

const Entries = {
	equality: (literal: Literal, op: Encoding.Atom.T["op"], a: EUF.Enode.Id, b: EUF.Enode.Id): Equality.Entry[] =>
		match(op)
			.with("=", () => [Entries.one(literal, a, b, true), Entries.one(-literal, a, b, false)])
			.with("!=", () => [Entries.one(literal, a, b, false), Entries.one(-literal, a, b, true)])
			.otherwise(() => []),

	arithmetic: (literal: Literal, atom: Encoding.Atom.T): Arithmetic.Entry[] =>
		match(atom.op)
			.with("=", () => [{ literal, atom }])
			.with("!=", () => [{ literal, atom }])
			.with("<", () => [{ literal, atom }])
			.with("<=", () => [{ literal, atom }])
			.with(">", () => [{ literal, atom }])
			.with(">=", () => [{ literal, atom }])
			.exhaustive(),

	one: (literal: Literal, a: EUF.Enode.Id, b: EUF.Enode.Id, positive: boolean): Equality.Entry => ({
		literal,
		equality: { a, b, positive },
	}),
};
