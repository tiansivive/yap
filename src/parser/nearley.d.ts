// The export marker makes this file a module, so the declaration below AUGMENTS
// nearley's types. Without it the file is ambient and would REPLACE them wholesale.
export {};

declare module "nearley" {
	export type PostProcessor<Data, T = void, W = {}> = Data extends Array<any> ? (data: Data, loc?: number, reject?: W) => T : never;
}
