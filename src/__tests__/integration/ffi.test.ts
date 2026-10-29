import { describe, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Language Tour — Foreign Function Interface", () => {
	test("basic FFI", async () => {
		const result = runScript(`
foreign print: String -> Unit;
foreign stringify: (a: Type) => a -> String;
let greet: String -> Unit = \\name -> {
    print ("Hello, " ++ name);
    return !;
};
		`);
		await snap(result);
	});

	test("polymorphic FFI", async () => {
		const result = runScript(`
foreign prepend: (a: Type) => a -> { [Num]: a } -> { [Num]: a };
foreign id: (a: Type) => a -> a;
let nums = prepend 42 [1, 2, 3];
let strs = prepend "a" ["b", "c"];
		`);
		await snap(result);
	});
});
