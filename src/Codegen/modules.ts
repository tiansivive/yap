import { match } from "ts-pattern";
import { Interface } from "../modules/loading";
import { entries } from "@yap/utils";

import * as E from "fp-ts/lib/Either";

import * as CG from "./terms";

export const codegen = (module: Interface, filepath: string) => {
	const imports = entries(module.imports).reduce((code, [filepath, [errs, values]]) => {
		const info = errs.map(([name, err]) => `\n// Error importing ${name}: ${err.type}`);

		const vars = values.map(([name]) => name).join(", ");
		const stmt = `\nconst { ${vars} } = require("./${filepath}.js");`;

		return code + stmt + info;
	}, "");

	const foreign = module.foreign.reduce((code, [name, result]) => {
		const stmt = E.isLeft(result)
			? `\n// Error importing ${name}: ${result.left}`
			: `\nconst { ${name} } = require("./${filepath.replace(/\.yap$/, ".ffi.js")}");`;
		return code + stmt;
	}, "");

	const letdecs = module.letdecs.reduce((code, [name, result]) => {
		const stmt = E.isLeft(result) ? `\n// Error importing ${name}: ${result.left}` : `\nlet ${name} = ${CG.codegen([name], result.right[0])};`;
		return code + stmt;
	}, "");

	const exports = `\nmodule.exports = { ${module.exports.join(", ")} };`;

	return imports + foreign + letdecs + exports;
};
