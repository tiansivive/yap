import { Context } from "z3-solver";

export const options = {
	verbose: false,
	showJS: false,
	showElaboration: false,
};

let Z3: Context<"main"> | undefined = undefined;

export const setZ3Context = (ctx: Context<"main">) => {
	Z3 = ctx;
};
export const getZ3Context = () => Z3;
