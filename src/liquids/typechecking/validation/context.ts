import { match } from "ts-pattern";
import { Binder, Variable } from "../../terms.js";

export type Context = { local: Binder[]; global: Record<string, Binder> };

export const lookup = (ctx: Context, x: Variable) =>
	match(x)
		.with({ tag: "Bound" }, ({ deBruijn }) => {
			if (deBruijn >= ctx.local.length) {
				throw `Variable not found in context: ${JSON.stringify(x)}`;
			}
			return ctx.local[deBruijn];
		})
		.with({ tag: "Free" }, ({ name }) => {
			if (!(name in ctx.global)) {
				throw `Variable not found in context: ${name}`;
			}
			return ctx.global[name];
		})
		.run();

export const extend: <T>(
	ctx: Context,
	binder: Binder,
	f: (ctx: Context) => T,
) => T = (ctx, binder, f) => f({ ...ctx, local: [binder, ...ctx.local] });
