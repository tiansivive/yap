import { describe, expect, test } from "vitest";
import { runScript, snap } from "./helpers/pipeline";

describe("Language Tour — Foreign Function Interface", () => {
	test("basic FFI", () => {
		const result = runScript(`
foreign print: String -> Unit;
foreign stringify: (a: Type) => a -> String;
let greet: String -> Unit = \\name -> {
    print ("Hello, " ++ name);
    return !;
};
		`);
		expect(snap(result)).toMatchSnapshot();
	});

	test("polymorphic FFI", () => {
		const result = runScript(`
foreign prepend: (a: Type) => a -> { [Num]: a } -> { [Num]: a };
foreign id: (a: Type) => a -> a;
let nums = prepend 42 [1, 2, 3];
let strs = prepend "a" ["b", "c"];
		`);
		expect(snap(result)).toMatchSnapshot();
	});
});
