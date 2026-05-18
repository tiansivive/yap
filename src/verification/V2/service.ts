import { createRuntime } from "./utils/context";
import { extractModalities } from "./utils/refinements";
import { createTranslationTools } from "./logic/translate";
import { createSubtype } from "./subtype";
import { createCheck } from "./check";
import { createSynth } from "./synth";

export type VerificationServiceOptions = {
	logging?: boolean;
};

export const VerificationServiceV2 = (options: VerificationServiceOptions = {}) => {
	const runtime = createRuntime(options);
	const translation = createTranslationTools(runtime, extractModalities);

	const subtype = createSubtype({ runtime, translation });
	const check = createCheck({ runtime, translation });
	const synth = createSynth({ runtime, translation });

	return {
		check,
		synth,
		subtype,
		getObligations: runtime.getObligations,
	};
};
