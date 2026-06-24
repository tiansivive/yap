import * as Mod from "./modules/loading";
import * as GRAM from "@yap/gram";
import * as Pipeline from "@yap/pipeline";
import * as E from "fp-ts/lib/Either";

import fs from "fs";
import path from "path";
import beautify from "js-beautify";

import * as Pretty from "./lowering/pretty";
import { emit as emitJS } from "./Codegen/v2/js/emit";
import { print as printJS } from "./Codegen/v2/js/print";
import { emit as emitC } from "./Codegen/v2/c/emit";
import { print as printC } from "./Codegen/v2/c/print";
import { Runtime as CRuntime } from "./Codegen/v2/c/runtime";
import { emit as emitErl } from "./Codegen/v2/erlang/emit";
import { print as printErl } from "./Codegen/v2/erlang/print";

export type Target = "js" | "c" | "erlang";

export type Options = {
	outDir: string;
	baseUrl: string;
	target: Target;
	emitGram: boolean;
	emitMir: boolean;
};

export const GlobalDefaults: Options = {
	outDir: "./bin/",
	baseUrl: "./yap/",
	target: "js",
	emitGram: true,
	emitMir: true,
};

const ensureDir = (dir: string): void => {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
};

const prepare: Record<Target, (outDir: string) => void> = {
	c: CRuntime.copy,
	erlang: () => undefined,
	js: () => undefined,
};

const ext = (target: Target): string => {
	switch (target) {
		case "js":
			return ".js";
		case "c":
			return ".c";
		case "erlang":
			return ".core";
	}
};

export const compile = (file: string, options: Partial<Options> = {}) => {
	const opts: Options = { ...GlobalDefaults, ...options };

	try {
		Mod.mkInterface(file, [], { outDir: opts.outDir, baseUrl: opts.baseUrl });

		ensureDir(opts.outDir);
		prepare[opts.target](opts.outDir);

		Object.entries(Mod.globalModules).forEach(([filepath, iface]) => {
			console.log("Processing module: " + filepath);

			const baseName = path.basename(filepath, ".yap");

			const results = iface.letdecs.map(([name, result]) => {
				if (E.isLeft(result)) {
					console.warn(`  Error in ${name}: skipped`);
					return null;
				}

				const [tm, ty, _us] = result.right;

				const lowered = Pipeline.lowerTerm(tm, iface, { parentBinders: [name] });

				if (E.isLeft(lowered)) {
					console.warn(`  ${lowered.left}`);
					return null;
				}

				return { name, graph: lowered.right.graph, mod: lowered.right.mod, ty };
			});

			const validResults = results.filter((r): r is NonNullable<typeof r> => r !== null);

			if (validResults.length === 0) {
				console.warn(`  No valid declarations in ${filepath}`);
				return;
			}

			if (opts.emitGram) {
				const gramOutput = validResults.map(r => `// ${r.name}\n${GRAM.display(r.graph)}`).join("\n\n");
				const gramFile = path.join(opts.outDir, `${baseName}.gram`);
				fs.writeFileSync(gramFile, gramOutput);
				console.log(`  Written: ${gramFile}`);
			}

			if (opts.emitMir) {
				const mirOutput = validResults.map(r => `// ${r.name}\n${Pretty.display.module(r.mod)}`).join("\n\n");
				const mirFile = path.join(opts.outDir, `${baseName}.mir`);
				fs.writeFileSync(mirFile, mirOutput);
				console.log(`  Written: ${mirFile}`);
			}

			const codegenOutput = validResults
				.map(r => {
					switch (opts.target) {
						case "js": {
							const program = emitJS(r.mod);
							return `// ${r.name}\n${printJS(program)}`;
						}
						case "c": {
							const raw = emitC(r.mod);
							return `// ${r.name}\n${printC(raw)}`;
						}
						case "erlang": {
							const ast = emitErl(r.mod);
							return `// ${r.name}\n${printErl(ast)}`;
						}
					}
				})
				.join("\n\n");

			const targetFile = path.join(opts.outDir, `${baseName}${ext(opts.target)}`);
			const formatted = opts.target === "js" ? beautify.js(codegenOutput, { indent_size: 2 }) : codegenOutput;
			fs.writeFileSync(targetFile, formatted);
			console.log(`  Written: ${targetFile}`);

			const FFIfile = filepath.replace(".yap", ".ffi.js");
			const FFIpath = path.join(opts.baseUrl, FFIfile);
			if (fs.existsSync(FFIpath)) {
				const destFFI = path.join(opts.outDir, path.basename(FFIfile));
				fs.copyFileSync(FFIpath, destFFI);
				console.log(`  Copied: ${destFFI}`);
			}

			console.log(`Compiled: ${filepath}`);
		});
	} catch (e) {
		console.error(e);
	}
};
