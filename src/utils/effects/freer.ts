/* eslint-disable no-restricted-syntax */
/* eslint-disable @typescript-eslint/no-explicit-any */

// ============================================================================
// Effect system
// ============================================================================

export type Eff<Op, A> = Generator<Op, A, unknown>;

export function run<const Effects extends readonly Effect<any, any, any>[], Op extends OpsOf<Effects[number]>, A>(
	program: () => Eff<Op, A>,
	effects: Effects,
): [A, Outputs<Effects>];

export function run<const Effects extends readonly Effect<any, any, any>[], Op extends OpsOf<Effects[number]>, A, R>(
	program: () => Eff<Op, A>,
	effects: Effects,
	answer: Answer<ErrorsOf<Effects[number]>, A, Outputs<Effects>, R>,
): R;

export function run(
	program: () => Eff<Operation, unknown>,
	effects: readonly Effect<string, Handlers, unknown>[],
	answer: Answer<unknown, unknown, unknown[], unknown> = {
		[RESUME]: (value, outputs) => [value, outputs],
		[ABORT]: (error): never => {
			if (error instanceof Error) {
				throw error;
			}

			throw new Error(String(error));
		},
	},
) {
	const drive = (computation: Eff<Operation, unknown>, effects: Effects): Outcome<unknown, unknown> => {
		let input: unknown;

		while (true) {
			const step = computation.next(input);

			if (step.done) {
				return resume(step.value);
			}

			const operation = step.value;

			const effect = effects.find(effect => effect[EFFECT].identity === operation.effect);
			const handler = effect?.[EFFECT].handlers[operation.action];

			if (!handler) {
				throw new Error(`Unhandled effect operation: ${operation.action}`);
			}

			// Operation arguments cross from an erased runtime operation into its handler.
			// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
			const control = handler.call(effect, ...operation.args);

			if (ABORT in control) {
				return control;
			}

			if (SCOPED in control) {
				const scoped = control[SCOPED];
				const nested = drive(scoped.action(), scoped.swap(effects));

				if (ABORT in nested) {
					return nested;
				}

				input = nested[RESUME];
				continue;
			}

			input = control[RESUME];
		}
	};

	const control = drive(program(), effects);

	if (ABORT in control) {
		return answer[ABORT](control[ABORT]);
	}

	return answer[RESUME](
		control[RESUME],
		effects.map(effect => effect.finalize()),
	);
}

// ============================================================================
// Effect builder
// ============================================================================

export function defineEffect<const Name extends string, const H extends Handlers>(name: Name, handlers: H): Effect<Name, H, undefined>;

export function defineEffect<const Name extends string, const H extends Handlers, Output>(
	name: Name,
	handlers: H,
	finalize: () => Output,
): Effect<Name, H, Output>;

export function defineEffect(name: string, handlers: Handlers, finalize: () => unknown = () => undefined): Effect<string, Handlers, unknown> {
	const actions: Record<string, (...args: any[]) => Eff<any, any>> = {};

	for (const action in handlers) {
		actions[action] = (...args: unknown[]): Eff<Operation, unknown> =>
			(function* (): Eff<Operation, unknown> {
				return yield {
					effect: actions,
					action,
					args,
				};
			})();
	}

	Object.defineProperty(actions, EFFECT, {
		value: {
			name,
			identity: actions,
			handlers,
		},
	});
	Object.defineProperty(actions, "finalize", {
		value: finalize,
	});

	// Dynamic handler keys cannot be correlated with H's statically known keys.
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
	return actions as Effect<string, Handlers, unknown>;
}

export function override<Original extends Effect<string, Handlers, unknown>, Replacement extends Effect<string, Handlers, unknown>>(
	original: Original,
	replacement: Replacement,
): Replacement {
	const metadata = replacement[EFFECT];

	// A scoped replacement handles operations already created by the original.
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
	return Object.create(replacement, {
		[EFFECT]: {
			value: {
				...metadata,
				identity: original[EFFECT].identity,
			},
		},
	}) as Replacement;
}

// ============================================================================
// Effect types
// ============================================================================

export const EFFECT = Symbol("effect");

export type Effect<Name extends string, H extends Handlers, Output> = Actions<Name, H> & {
	readonly [EFFECT]: {
		readonly name: Name;
		readonly identity: object;
		readonly handlers: H;
	};
	readonly finalize: () => Output;
};

type Outputs<Effects extends readonly Effect<any, any, any>[]> = {
	[K in keyof Effects]: Effects[K] extends Effect<any, any, infer Output> ? Output : never;
};

export type Handlers = Record<string, Handler>;
export type Handler = (...args: any[]) => Control<any, any>;

type Effects = readonly Effect<string, Handlers, unknown>[];

type Actions<Name extends string, D extends Handlers> = {
	[K in keyof D & string]: (...args: Parameters<D[K]>) => Eff<OperationWithPhantoms<Name, K, D[K]>, ValueOf<ReturnType<D[K]>>>;
};

type OperationWithPhantoms<Name extends string, Action extends string, F extends Handler> = {
	readonly effect: object;
	readonly __effect?: Name;
	readonly action: Action;
	readonly args: Parameters<F>;
	readonly __resume?: ValueOf<ReturnType<F>>;
	readonly __abort?: ErrorOf<ReturnType<F>>;
};

export type Operation = Pick<OperationWithPhantoms<string, string, Handler>, "effect" | "action" | "args">;

type ValueOf<C> = C extends Control<any, infer A> ? A : never;

// ============================================================================
// Control
// ============================================================================

export type Control<E, A> = Resume<A> | Abort<E> | Scoped<A>;

type Outcome<E, A> = Resume<A> | Abort<E>;

export type Resume<A> = {
	readonly [RESUME]: A;
};

export type Abort<E> = {
	readonly [ABORT]: E;
};

export type Scoped<A> = {
	readonly [SCOPED]: {
		readonly action: () => Eff<Operation, A>;
		readonly swap: (effects: Effects) => Effects;
	};
};

export const resume = <A>(value: A): Resume<A> => ({
	[RESUME]: value,
});

export const abort = <E>(error: E): Abort<E> => ({
	[ABORT]: error,
});

export const scoped = <A>(action: () => Eff<Operation, A>, swap: (effects: Effects) => Effects): Scoped<A> => ({
	[SCOPED]: { action, swap },
});

export const RESUME = Symbol("resume");
export const ABORT = Symbol("abort");
export const SCOPED = Symbol("scoped");

// ============================================================================
// Answer interpretation
// ============================================================================

export type Answer<E, A, Outputs, R> = {
	readonly [RESUME]: (value: A, outputs: Outputs) => R;
	readonly [ABORT]: (error: E) => R;
};

// Default:
//
//   RESUME → return the program value
//   ABORT  → throw a JavaScript exception

// const Reader = <R,>(env: R) => defineEffect("Reader", {
//   ask: () => resume(env),
// });

// const reader = Reader({ foo: 1})
// const { ask } = reader;

// const errors = defineEffect("Errors", {
//   fail: (message: string) => abort(new Error(message)),
// });
// function* program(){
//   const environment = yield* ask();

//   if (!environment) {
//     return yield* errors.fail("Missing environment");
//   }

//   return environment.foo;
// }

// const _errors2 = defineEffect("Errors", {
//   fail: (message: string) => {
//     console.log("error", message);
//     return abort(message);
//   }
// });

// run(program, [reader, errors], {
//   [ABORT]: (error) => {
//     console.log("Caught error:", error);
//     return -1;
//   },
//   [RESUME]: (value) => {
//     console.log("Program completed with value:", value);
//     return value;
//   }
// })

// ============================================================================
// Type extraction
// ============================================================================

export type OpsOf<E> = E extends {
	readonly [EFFECT]: {
		readonly name: infer Name extends string;
		readonly handlers: infer H extends Handlers;
	};
}
	? { [K in keyof H & string]: OperationWithPhantoms<Name, K, H[K]> }[keyof H & string]
	: never;

type ErrorsOf<Eff extends Effect<any, any, any>> = Eff extends Effect<any, infer H, any> ? ErrorOf<ReturnType<H[keyof H & string]>> : TypeError;

type ErrorOf<C> = C extends Abort<infer E> ? E : never;
