import type { Tag, Label } from "../vocabulary";
import { Tags, Labels } from "../vocabulary";
import type { Pass } from "../grs/strategy";

export type Vocabulary = {
	readonly tags: ReadonlySet<Tag>;
	readonly labels: ReadonlySet<Label>;
};

export type Delta = {
	readonly added: ReadonlySet<Tag | Label>;
	readonly removed: ReadonlySet<Tag | Label>;
};

export type Descriptor = {
	readonly name: string;
	readonly requires: Vocabulary;
	readonly delta: {
		readonly tags: Delta;
		readonly labels: Delta;
	};
	readonly run: Pass;
};

const tags = (...ts: Tag[]): ReadonlySet<Tag> => new Set(ts);
const labels = (...ls: Label[]): ReadonlySet<Label> => new Set(ls);

export const Initial: Vocabulary = {
	tags: tags(
		Tags.ROOT,
		Tags.LIT,
		Tags.VAR_BOUND,
		Tags.VAR_FREE,
		Tags.VAR_FOREIGN,
		Tags.VAR_LABEL,
		Tags.VAR_META,
		Tags.VAR_REF,
		Tags.LAMBDA,
		Tags.PI,
		Tags.SIGMA,
		Tags.MU,
		Tags.LET,
		Tags.APP,
		Tags.ROW_EXT,
		Tags.ROW_EMPTY,
		Tags.STRUCT,
		Tags.PROJ,
		Tags.INJ,
		Tags.MATCH,
		Tags.CASE,
		Tags.PAT_VARIANT,
		Tags.PAT_STRUCT,
		Tags.PAT_LIT,
		Tags.PAT_BINDER,
		Tags.PAT_WILDCARD,
		Tags.BLOCK,
		Tags.STMT_LET,
		Tags.STMT_EXPR,
		Tags.STMT_USING,
		Tags.MODAL,
		Tags.RESET,
		Tags.SHIFT,
	),
	labels: labels(
		Labels.BODY,
		Labels.FUNC,
		Labels.ARG,
		Labels.ANNOTATION,
		Labels.VALUE,
		Labels.REST,
		Labels.TAIL,
		Labels.TARGET,
		Labels.SCRUTINEE,
		Labels.RETURN,
		Labels.TERM,
		Labels.ENTRY,
		Labels.SCOPE,
		Labels.REFERS_TO,
		Labels.STMT,
		Labels.ALT,
		Labels.NEXT,
		Labels.PATTERN,
		Labels.PAYLOAD,
		Labels.FIELD,
	),
};

export const none: Delta = { added: new Set(), removed: new Set() };
