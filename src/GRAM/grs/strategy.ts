import type { Graph } from "../graph";
import type { Rule, Bindings } from "./rule";
import { Match } from "./match";
import * as Rewrite from "./rewrite";

export type Pass = (g: Graph) => Graph;

export const apply =
	(rule: Rule): Pass =>
	(g: Graph): Graph => {
		const step = (current: Graph): Graph => {
			const next = Rewrite.apply(rule, current);
			return next ? step(next) : current;
		};
		return step(g);
	};

export const once =
	(rule: Rule): Pass =>
	(g: Graph): Graph =>
		Rewrite.apply(rule, g) ?? g;

export const seq =
	(...passes: Pass[]): Pass =>
	(g: Graph): Graph =>
		passes.reduce((acc, pass) => pass(acc), g);

export const try_ = (rule: Rule): Pass => once(rule);

export const choice =
	(...rules: Rule[]): Pass =>
	(g: Graph): Graph =>
		rules.reduce<Graph | undefined>((result, rule) => {
			if (result !== g) {
				return result ?? g;
			}
			return Rewrite.apply(rule, g) ?? undefined;
		}, undefined) ?? g;

export const repeat =
	(pass: Pass, max = 100): Pass =>
	(g: Graph): Graph => {
		const step = (current: Graph, i: number): Graph => {
			if (i >= max) {
				return current;
			}
			const next = pass(current);
			return next.nodes === current.nodes && next.edges === current.edges ? next : step(next, i + 1);
		};
		return step(g, 0);
	};

export const derive =
	(anchor: Rule, build: (bindings: Bindings, host: Graph) => Rule): Pass =>
	(g: Graph): Graph => {
		const step = (current: Graph): Graph => {
			const b = Match.one(anchor, current);

			if (!b) {
				return current;
			}
			const rule = build(b, current);
			const next = Rewrite.apply(rule, current, b);
			return next ? step(next) : current;
		};
		return step(g);
	};
