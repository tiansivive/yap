import * as E from "fp-ts/Either";
import type { Either } from "fp-ts/lib/Either";
import type { Conflict } from "../cdcl";

export const conflictValue = <A>(result: Either<Conflict, A>): A =>
	E.match(
		(left: Conflict): A => {
			throw new Error(left.clause.origin);
		},
		(right: A): A => right,
	)(result);

export const conflictOf = <A>(result: Either<Conflict, A>): Conflict =>
	E.match(
		(left: Conflict): Conflict => left,
		(): Conflict => {
			throw new Error("expected conflict");
		},
	)(result);

export const tag = <Err, A>(result: Either<Err, A>): "Left" | "Right" =>
	E.match(
		(_err: Err) => "Left" as const,
		(_value: A) => "Right" as const,
	)(result);
