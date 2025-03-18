import Grammar from "./parser/grammar";

import Nearley from "nearley";

import * as Q from "../utils/files";

import * as Src from "@qtt/src/index";
import * as EB from "@qtt/elaboration";
import * as NF from "@qtt/elaboration/normalization";
import * as Lit from "@qtt/shared/literals";
import { mkLogger } from "@qtt/shared/logging";
import * as Log from "@qtt/shared/logging";

import * as Lib from "@qtt/shared/lib/primitives";

import * as E from "fp-ts/Either";
import { displayProvenance } from "./elaboration/solver";

import * as Err from "@qtt/elaboration/errors";

try {
} catch (e) {
	console.error(e);
}
