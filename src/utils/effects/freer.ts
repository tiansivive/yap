/* eslint-disable @typescript-eslint/consistent-type-assertions */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-restricted-syntax */

// ============================================================================
// Actions are the primitive. Effects are however you choose to group them.
// ============================================================================

/*
 * An Action is one operation: a tag, a payload, and the type a handler must
 * answer it with. Yielding one puts it in the program's row, so a row is
 * inferred from what a program actually does rather than declared up front:
 *
 *   const ask = function* () { return yield* ctl.action<Ask>("Reader.ask", undefined) };
 *
 *   function* program() {
 *     const environment = yield* ask();
 *     yield* tell(environment.host);
 *     return environment.verbose;
 *   }
 *   //  ^? Generator<Ask | Tell, boolean, unknown>
 *
 * run then refuses a handler list that does not cover the row, and answers with
 * the program's value followed by each handler's output.
 *
 * Nothing here groups actions. A Reader is a record you write by hand, and if
 * it hands back a callback for its handlers then its handlers are swappable.
 *
 * An action declares; its handler controls. Every clause answers with a
 * Control value: ctl.resume(v) feeds v back to the program, ctl.abort(v)
 * discards the rest of the program and makes v the answer of whatever scope
 * installed that handler — the run, or an Eff.with. What a handler can abort
 * with is its Raises parameter, so failure shows up on the handler, not the
 * action.
 */

export type Action<Tag extends string, Payload, A> = {
	readonly tag: Tag;
	readonly payload: Payload;

	/*
	 * A is what a resuming clause answers the program with, so that is what
	 * yield* gives back. An action whose A is never cannot be resumed — its
	 * handlers can only abort — and a call to it does not return.
	 */
	[Symbol.iterator](): Generator<Action<Tag, Payload, A>, A, unknown>;
};

export type AnyAction = Action<string, any, any>;

type Answer<Act> = Act extends Action<string, any, infer A> ? A : never;

/** What a clause answers: feed the program, or answer the installing scope. */
export type Control<A = unknown, E = unknown> = { readonly control: "resume"; readonly value: A } | { readonly control: "abort"; readonly value: E };

/** The error an aborted scope answered with. */
export const ABORT: unique symbol = Symbol("abort");

export type Aborted<E> = { readonly [ABORT]: E };

/* Extract rather than E | Aborted<E>, which would need one E to be both. */
export const failed = <A>(answer: A): answer is Extract<A, Aborted<unknown>> => typeof answer === "object" && answer !== null && ABORT in answer;

/** A computation yielding the actions in Row and answering with an A. */
export type Eff<Row extends AnyAction, A> = Generator<Row, A, unknown>;

/** A computation that yields nothing and answers with a. */
export function* of<A>(a: A): Eff<never, A> {
	return a;
}

/** Runs f over items in order, answering with every answer. */
export function* traverse<Row extends AnyAction, A, B>(items: readonly A[], f: (item: A, index: number) => Eff<Row, B>): Eff<Row, B[]> {
	const collected: B[] = [];

	for (const [index, item] of items.entries()) {
		collected.push(yield* f(item, index));
	}

	return collected;
}

const build = (tag: string, payload: unknown) => {
	const self = {
		tag,
		payload,

		*[Symbol.iterator](): Generator<unknown, unknown, unknown> {
			return yield self;
		},
	};

	return self;
};

export const ctl = {
	/** Declares one operation. Yieldable, so one reads as `yield* ctl.action(…)`. */
	action: <Act extends AnyAction>(tag: Act["tag"], payload: Act["payload"]): Act => build(tag, payload) as unknown as Act,

	/** Answer the program, which carries on. */
	resume: <A>(value: A): Control<A, never> => ({ control: "resume", value }),

	/** Answer the scope that installed this handler; the program is discarded. */
	abort: <E>(value: E): Control<never, E> => ({ control: "abort", value }),
};

/**
 * Answers some part of a row, and contributes one output to the result.
 *
 * A clause takes its action's payload and answers with a Control: resume what
 * the action's type promised, or abort with a Raises. Handlers are matched
 * last-to-first, so a later one shadows an earlier one for the tags they share.
 */
export type Handler<Row extends AnyAction, Output, Raises = never> = {
	readonly clauses: {
		[Tag in Row["tag"]]: (payload: Extract<Row, { tag: Tag }>["payload"]) => Control<Answer<Extract<Row, { tag: Tag }>>, Raises>;
	};
	readonly output: () => Output;
};

/*
 * The actions an effect offers, read off the row its handlers cover.
 *
 * Takes one effect or a tuple of them, so a row is named once and reused:
 *
 *   const Env = reader<Context>();
 *   const Log = writer(constraints);
 *   const Fail = except<Cause>();
 *
 *   type Elaboration<A> = Eff<Actions<[typeof Env, typeof Log, typeof Fail]>, A>;
 */
export type Actions<Effects> = Effects extends readonly unknown[] ? { [I in keyof Effects]: Offered<Effects[I]> }[number] : Offered<Effects>;

/** The actions of an effect narrowed to specific tags: a row names exactly what it may yield. */
export type Only<Effect, Tags extends Actions<Effect>["tag"]> = Extract<Actions<Effect>, { tag: Tags }>;

type Offered<Effect> = Effect extends {
	handlers: (...args: any[]) => Handler<infer Row, any, any>;
}
	? Row
	: never;

type Covered<Handlers extends readonly unknown[]> = {
	[I in keyof Handlers]: Handlers[I] extends Handler<infer Row, any, any> ? Row : never;
}[number];

type Outputs<Handlers extends readonly unknown[]> = {
	[I in keyof Handlers]: Handlers[I] extends Handler<any, infer Output, any> ? Output : never;
};

/** Everything the given handlers can abort with. */
type Raised<Handlers extends readonly unknown[]> = {
	[I in keyof Handlers]: Handlers[I] extends Handler<any, any, infer Raises> ? Raises : never;
}[number];

/** The value slot of a scope's answer: plain when no handler can abort. */
type Outcome<A, Raises> = [Raises] extends [never] ? A : A | Aborted<Raises>;

/* One cast at the boundary; the interpreters have no use for the precise types. */
type Erased = {
	readonly clauses: Readonly<Record<string, (payload: unknown) => Control>>;
	readonly output: () => unknown;
};

/** Flattened clause lookup; a later handler shadows an earlier one per tag. */
const clausesOf = (handlers: readonly Erased[]): Map<string, (payload: unknown) => Control> =>
	new Map(handlers.flatMap(handler => Object.entries(handler.clauses)));

/*
 * [Row] extends [Covered] rather than Row extends Covered: a bare union in a
 * conditional distributes, which would let any single covered action satisfy
 * the whole row.
 */
export function run<Row extends AnyAction, A, const Handlers extends readonly Handler<any, any, any>[]>(
	program: () => Eff<Row, A>,
	handlers: Handlers & ([Row] extends [Covered<Handlers>] ? unknown : { readonly missing: Exclude<Row["tag"], Covered<Handlers>["tag"]> }),
): readonly [Outcome<A, Raised<Handlers>>, ...Outputs<Handlers>] {
	type Result = readonly [Outcome<A, Raised<Handlers>>, ...Outputs<Handlers>];

	const erased = handlers as unknown as readonly Erased[];
	const clauses = clausesOf(erased);

	const computation = program();
	let input: unknown;
	let started = false;

	while (true) {
		const step = started ? computation.next(input) : computation.next();
		started = true;

		const outputs = (): unknown[] => erased.map(handler => handler.output());

		if (step.done) {
			return [step.value, ...outputs()] as unknown as Result;
		}

		const clause = clauses.get(step.value.tag);

		if (!clause) {
			throw new Error(`No handler for ${step.value.tag}`);
		}

		const answered = clause(step.value.payload);

		/* An aborting clause answers for the run, so outputs still come back with it. */
		if (answered.control === "abort") {
			computation.return(undefined as unknown as A);

			return [{ [ABORT]: answered.value }, ...outputs()] as unknown as Result;
		}

		input = answered.value;
	}
}

/*
 * Runs a program with part of its row handled here, forwarding the rest.
 *
 * Two rules, both already the system's own:
 * - The given handlers answer their tags; every other action is re-yielded
 *   to the enclosing run. A handled effect is private to this scope — a
 *   fresh resource per call; a forwarded one stays shared, which is why a
 *   nested `run` (forking shared handlers) is the wrong tool here.
 * - The installing scope is the delimiter. A local clause that aborts
 *   answers this scope — the program is discarded and the abort shows up
 *   in the value slot, same protocol as run. An uncovered abort forwards
 *   and delimits wherever its handler was installed. Nothing unwinds inner
 *   generators — do not rely on try/finally in effect programs.
 *
 * Answers like run: the program's value (or this scope's abort), then each
 * handler's output.
 */
function* scoped<Row extends AnyAction, A, const Handlers extends readonly Handler<any, any, any>[]>(
	handlers: Handlers,
	program: () => Eff<Row, A>,
): Generator<Exclude<Row, { tag: Covered<Handlers>["tag"] }>, readonly [Outcome<A, Raised<Handlers>>, ...Outputs<Handlers>], unknown> {
	type Forwarded = Exclude<Row, { tag: Covered<Handlers>["tag"] }>;
	type Result = readonly [Outcome<A, Raised<Handlers>>, ...Outputs<Handlers>];

	const erased = handlers as unknown as readonly Erased[];
	const clauses = clausesOf(erased);

	const computation = program();
	let input: unknown;

	while (true) {
		const step = computation.next(input);

		const outputs = (): unknown[] => erased.map(handler => handler.output());

		if (step.done) {
			return [step.value, ...outputs()] as unknown as Result;
		}

		const clause = clauses.get(step.value.tag);

		if (!clause) {
			input = yield step.value as Forwarded;
			continue;
		}

		const answered = clause(step.value.payload);

		if (answered.control === "abort") {
			computation.return(undefined as unknown as A);

			return [{ [ABORT]: answered.value }, ...outputs()] as unknown as Result;
		}

		input = answered.value;
	}
}

export { scoped as with };
