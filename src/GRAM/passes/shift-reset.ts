import { descriptor as effects } from "./effects";
import { enrich } from "./control/enrich";
import type { Descriptor } from "../pipeline/descriptor";

export const shiftReset = enrich;

export const descriptor: Descriptor = { ...effects, name: "shift-reset", run: shiftReset };
