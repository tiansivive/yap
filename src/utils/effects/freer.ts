/* eslint-disable @typescript-eslint/consistent-type-assertions */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-restricted-syntax */

// ============================================================================
// Actions are the primitive. Effects are however you choose to group them.
// ============================================================================

/*
 * An Action is one operation: a tag, a payload, the type a handler must answer
 * it with, and which control it exercises. Yielding one puts it in the
 * program's row, so a row is inferred from what a program actually does rather
 * than declared up front:
 *
 *   const ask = function* () { return yield* ctl.resume<Ask>("Reader.ask", undefined) };
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
 * An action's control says where its clause's answer goes. A resume action feeds
 * it back to the program; an abort action makes it the run's answer and the loop
 * breaks. Only a row containing an abort action widens the result, and it widens
 * by that action's own answer type, so what a program can fail with shows up in
 * its type and a program that cannot fail does not have to say so.
 */

export type Control = "resume" | "abort";

export type Action<Tag extends string, Payload, A, C extends Control = "resume"> = {
	readonly tag: Tag;
	readonly payload: Payload;
	readonly control: C;

	/*
	 * A is what this action's clause answers with. A resume clause answers the
	 * program, so that is what yield* gives back; an abort clause answers the run
	 * instead, so the program gets never and a call to it does not return.
	 */
	[Symbol.iterator](): Generator<Action<Tag, Payload, A, C>, C extends "abort" ? never : A, unknown>;
};

export type AnyAction = Action<string, any, any, Control>;

type Answer<Act> = Act extends Action<string, any, infer A, Control> ? A : never;

/** The actions in a row that break the loop rather than feeding it. */
type Failing<Row extends AnyAction> = Extract<Row, { control: "abort" }>;

/** The error an aborted run answered with. */
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

const build = (tag: string, payload: unknown, control: Control) => {
	const self = {
		tag,
		payload,
		control,

		*[Symbol.iterator](): Generator<unknown, unknown, unknown> {
			return yield self;
		},
	};

	return self;
};

/* Action builders. Yieldable, so one reads as `yield* ctl.resume(…)`. */
export const ctl = {
	/** Its clause answers the program, which carries on. */
	resume: <Act extends Action<string, any, any, "resume">>(tag: Act["tag"], payload: Act["payload"]): Act => build(tag, payload, "resume") as unknown as Act,

	/** Its clause answers the whole run, and the loop breaks. */
	abort: <Act extends Action<string, any, any, "abort">>(tag: Act["tag"], payload: Act["payload"]): Act => build(tag, payload, "abort") as unknown as Act,
};

/**
 * Answers some part of a row, and contributes one output to the result.
 *
 * A clause takes its action's payload and answers with what that action's type
 * promised. Handlers are matched last-to-first, so a later one shadows an
 * earlier one for the tags they share.
 */
export type Handler<Row extends AnyAction, Output> = {
	readonly clauses: {
		[Tag in Row["tag"]]: Extract<Row, { tag: Tag }> extends {
			readonly control: "abort";
		}
			? (payload: Extract<Row, { tag: Tag }>["payload"]) => unknown
			: (payload: Extract<Row, { tag: Tag }>["payload"]) => Answer<Extract<Row, { tag: Tag }>>;
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

type Offered<Effect> = Effect extends {
	handlers: (...args: any[]) => Handler<infer Row, any>;
}
	? Row
	: never;

type Covered<Handlers extends readonly unknown[]> = {
	[I in keyof Handlers]: Handlers[I] extends Handler<infer Row, any> ? Row : never;
}[number];

type Outputs<Handlers extends readonly unknown[]> = {
	[I in keyof Handlers]: Handlers[I] extends Handler<any, infer Output> ? Output : never;
};

/* One cast at the boundary; the interpreters have no use for the precise types. */
type Erased = {
	readonly clauses: Readonly<Record<string, (payload: unknown) => unknown>>;
	readonly output: () => unknown;
};

/** Flattened clause lookup; a later handler shadows an earlier one per tag. */
const clausesOf = (handlers: readonly Erased[]): Map<string, (payload: unknown) => unknown> =>
	new Map(handlers.flatMap(handler => Object.entries(handler.clauses)));

/*
 * [Row] extends [Covered] rather than Row extends Covered: a bare union in a
 * conditional distributes, which would let any single covered action satisfy
 * the whole row.
 */
export function run<Row extends AnyAction, A, const Handlers extends readonly Handler<any, any>[]>(
	program: () => Eff<Row, A>,
	handlers: Handlers & ([Row] extends [Covered<Handlers>] ? unknown : { readonly missing: Exclude<Row["tag"], Covered<Handlers>["tag"]> }),
): readonly [[Failing<Row>] extends [never] ? A : A | Aborted<Answer<Failing<Row>>>, ...Outputs<Handlers>] {
	type Result = readonly [[Failing<Row>] extends [never] ? A : A | Aborted<Answer<Failing<Row>>>, ...Outputs<Handlers>];

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

		/* An abort clause answers for the run, so outputs still come back with it. */
		if (step.value.control === "abort") {
			computation.return(undefined as unknown as A);

			return [{ [ABORT]: answered }, ...outputs()] as unknown as Result;
		}

		input = answered;
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
 * - A resume answer goes back into the program; an abort answer goes
 *   outward — same rule as run, where outward means return; here it means
 *   yield. The run stays the only abort delimiter, so aborts always remain
 *   in the forwarded row, and this scope never resumes after one — do not
 *   rely on try/finally in effect programs.
 *
 * Answers like run: the program's value, then each handler's output.
 */
function* scoped<Row extends AnyAction, A, const Handlers extends readonly Handler<any, any>[]>(
	handlers: Handlers,
	program: () => Eff<Row, A>,
): Generator<Exclude<Row, { tag: Covered<Handlers>["tag"]; control: "resume" }>, readonly [A, ...Outputs<Handlers>], unknown> {
	type Forwarded = Exclude<Row, { tag: Covered<Handlers>["tag"]; control: "resume" }>;

	const erased = handlers as unknown as readonly Erased[];
	const clauses = clausesOf(erased);

	const computation = program();
	let input: unknown;

	while (true) {
		const step = computation.next(input);

		if (step.done) {
			return [step.value, ...erased.map(handler => handler.output())] as unknown as readonly [A, ...Outputs<Handlers>];
		}

		const clause = clauses.get(step.value.tag);
		const answer = clause ? clause(step.value.payload) : yield step.value as Forwarded;

		if (step.value.control === "abort") {
			yield { ...step.value, payload: answer } as Forwarded;
		} else {
			input = answer;
		}
	}
}

export { scoped as with };
