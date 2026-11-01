import type { Descriptor } from "../pipeline/descriptor";
import { Tags, Labels } from "../vocabulary";
import { enrich } from "./control/enrich";

export const effects = enrich;

export const descriptor: Descriptor = {
	name: "effects",
	requires: { tags: new Set([Tags.CAPTURE, Tags.RESET]), labels: new Set([Labels.IDENTITY, Labels.HANDLER, Labels.BODY]) },
	delta: {
		tags: { added: new Set([Tags.BUBBLE, Tags.CONTINUATION, Tags.RESUMPTION]), removed: new Set() },
		labels: { added: new Set([Labels.HOLE, Labels.CAPTURED_AT, Labels.DELIMITER, Labels.INVOKES, Labels.DERIVED_FROM]), removed: new Set() },
	},
	run: effects,
};
