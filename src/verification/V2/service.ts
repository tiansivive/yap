import { createRuntime } from "./utils/context";
import { extractModalities } from "./utils/refinements";
import { createTranslationTools } from "./logic/translate";
import { createSubtype } from "./subtype";

import { createCheck } from "./check";
import { createSynth } from "./synth";
import { Context } from "z3-solver";

export type VerificationServiceOptions = {
	logging?: boolean;
};

export const VerificationServiceV2 = (Z3: Context<"main">, options: VerificationServiceOptions = {}) => {
	const runtime = createRuntime(options);
	const translation = createTranslationTools(Z3, runtime, extractModalities);

	const subtype = createSubtype({ Z3, runtime, translation });
	const check = createCheck({ Z3, runtime, translation });
	const synth = createSynth({ Z3, runtime, translation });

	return {
		check,
		synth,
		subtype,
		getObligations: runtime.getObligations,
	};
};
