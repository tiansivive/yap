import { ParserRule } from "nearley";

declare module "nearley" {
	export type PostProcessor<Data, T = void, W = {}> =
		Data extends Array<any>
			? (data: Data, loc?: number, reject?: W) => T
			: never;
}
