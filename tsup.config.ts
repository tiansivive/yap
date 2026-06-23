import { defineConfig } from "tsup";

const loader = {
	".lama": "text",
} as const;

export default defineConfig([
	{
		bundle: true,
		clean: true,
		dts: false,
		entry: {
			"scripts/cli": "scripts/cli.ts",
		},
		format: "cjs",
		outDir: "lib",
		platform: "node",
		sourcemap: true,
		target: "node18",
		loader,
	},
]);
