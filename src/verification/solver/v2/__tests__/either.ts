import * as E from "fp-ts/Either";
import type { Either } from "fp-ts/lib/Either";

export const conflictValue = <Err, A>(result: Either<Err, A>): A =>
	E.match(
		(left: Err): A => {
			throw new Error(`unexpected Left: ${JSON.stringify(left)}`);
		},
		(right: A): A => right,
	)(result);

export const conflictOf = <Err, A>(result: Either<Err, A>): Err =>
	E.match(
		(left: Err): Err => left,
		(): Err => {
			throw new Error("expected conflict");
		},
	)(result);

export const tag = <Err, A>(result: Either<Err, A>): "Left" | "Right" =>
	E.match(
		(_err: Err) => "Left" as const,
		(_value: A) => "Right" as const,
	)(result);
