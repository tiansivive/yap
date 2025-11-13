import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		clearMocks: true,
		coverage: {
			all: true,
			exclude: ["lib", "bin", "debug"],
			include: ["src"],
			reporter: ["html", "lcov"],
		},
		exclude: ["lib", "bin", "debug", "node_modules", "src/elaboration/elaboration.test.ts", "src/elaboration/unification/unification.test.ts"],
		setupFiles: ["console-fail-test/setup", "src/__tests__/setup.ts"],
		disableConsoleIntercept: true,
	},
});
