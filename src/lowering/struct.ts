import assert from "node:assert";
import type * as EB from "@yap/elaboration";
import * as MIR from "./mir";
import * as M from "./monad";
import { extractFields, pushChildrenReversed } from "./shared/helpers";

const { Instr } = MIR.Constructors;

export const data = (row: EB.Row): M.Lowering<void> =>
	M.Do(function* () {
		const ctx = yield* M.ask();
		const fields = extractFields(row);
		yield* M.Worklist.push({
			type: "Cont",
			arity: fields.length,
			handler: results =>
				M.Do(function* () {
					const result = ctx.nextVar();
					yield* M.Pending.append(
						Instr.Alloc({ type: "Record", fields: results.map((r, i) => ({ label: fields[i]?.label ?? "", value: r.value.name })) }, result.name),
					);
					yield* M.Results.push({ tag: "value", value: result });
				}),
		});
		yield* pushChildrenReversed(
			ctx,
			fields.map(f => f.term),
		);
	});

export const projection = (label: string, term: EB.Term): M.Lowering<void> =>
	M.Do(function* () {
		const ctx = yield* M.ask();
		yield* M.Worklist.push({
			type: "Cont",
			arity: 1,
			handler: ([target]) =>
				M.Do(function* () {
					assert(target);
					const result = ctx.nextVar();
					yield* M.Pending.append(Instr.Read(label, target.value.name, result.name));
					yield* M.Results.push({ tag: "value", value: result });
				}),
		});
		yield* M.Worklist.push({ type: "Lower", ctx, term });
	});

export const injection = (label: string, value: EB.Term, term: EB.Term): M.Lowering<void> =>
	M.Do(function* () {
		const ctx = yield* M.ask();
		yield* M.Worklist.push({
			type: "Cont",
			arity: 2,
			handler: ([intoR, valueR]) =>
				M.Do(function* () {
					assert(intoR);
					assert(valueR);
					const result = ctx.nextVar();
					yield* M.Pending.append(
						Instr.UpdateImmutable(intoR.value.name, result.name, {
							type: "Record",
							fields: [{ label, value: valueR.value.name }],
						}),
					);
					yield* M.Results.push({ tag: "value", value: result });
				}),
		});
		yield* M.Worklist.push({ type: "Lower", ctx, term: value });
		yield* M.Worklist.push({ type: "Lower", ctx, term });
	});
