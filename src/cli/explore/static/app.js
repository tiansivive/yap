import { basicSetup, EditorView } from "https://esm.sh/codemirror@6.0.2";
import { StreamLanguage } from "https://esm.sh/@codemirror/language";
import { oneDark } from "https://esm.sh/@codemirror/theme-one-dark";
import { javascript } from "https://esm.sh/@codemirror/legacy-modes/mode/javascript";
import { c } from "https://esm.sh/@codemirror/legacy-modes/mode/clike";
import { erlang } from "https://esm.sh/@codemirror/legacy-modes/mode/erlang";
import { smtlib } from "/syntax/smtlib.js";
import { yap } from "/syntax/yap.js";
import { mir } from "/syntax/mir.js";
import { gram } from "/syntax/gram.js";

// ── Snippets ──

const SNIPPETS = [
	{ id: "identity", group: "Basics", label: "Identity application", code: "(\\x -> x) 42" },
	{ id: "annotated", group: "Basics", label: "Annotated lambda", code: "\\(x: String) -> x" },
	{ id: "implicit", group: "Basics", label: "Implicit argument", code: '(\\x => \\(y: String) -> y) "hello"' },
	{ id: "bool", group: "Basics", label: "Boolean literal", code: "true" },
	{ id: "higher-order", group: "Functions", label: "Higher-order", code: "\\f -> \\x -> f (f x)" },
	{ id: "multi-param", group: "Functions", label: "Multi-param arrow", code: "(x: Num) -> (y: Num) -> Num" },
	{ id: "implicit-pi", group: "Functions", label: "Implicit Pi", code: "(x: Num) => Num" },
	{ id: "struct", group: "Row types", label: "Struct projection", code: "{ x: 1, y: 2 }.x" },
	{ id: "poly-proj", group: "Row types", label: "Polymorphic projection", code: "\\obj -> obj.x" },
	{ id: "sigma", group: "Row types", label: "Dependent struct", code: "{ x: 1, y: :x + 2 }" },
	{ id: "nested-sigma", group: "Row types", label: "Nested dependent", code: "{ point: { x: 1, y: 2 }, halved: { a: :point.x / 2, b: :point.y / 2 } }" },
	{ id: "row-poly", group: "Row types", label: "Row polymorphism", code: "\\(r: Row) -> { foo: Num | r }" },
	{ id: "tuple", group: "Row types", label: "Tuple", code: '{ 1, "hello", true }' },
	{ id: "variant-match", group: "Pattern matching", label: "Variant match", code: "\\x -> match x | #nil a -> 0 | #cons {el, rest} -> 1" },
	{ id: "struct-match", group: "Pattern matching", label: "Struct destructure", code: "match { x: 1 } | { x: a } -> a" },
	{
		id: "nested-match",
		group: "Pattern matching",
		label: "Nested struct match",
		code: "\\x -> match x | { foo: { y: y }, bar: f } -> f y | { z: { w: w } } -> w",
	},
	{ id: "wildcard", group: "Pattern matching", label: "Wildcard + literal", code: "match 1 | 1 -> 2" },
	{ id: "block", group: "Blocks", label: "Let binding", code: "{ let id = \\x -> x; return id 42; }" },
	{ id: "block-proj", group: "Blocks", label: "Let + projection", code: "{ let proj = \\obj -> obj.x; }" },
];

// ── Inspection config ──

const GROUPS = [
	{
		key: "typechecker",
		label: "Typechecker",
		tabs: [
			{ key: "parsed", label: "Parsed", mode: yap },
			{ key: "elaborated", label: "Elaborated", mode: yap },
			{ key: "constraints", label: "Constraints", mode: null },
			{ key: "metas", label: "Metas / Zonker", mode: null },
			{ key: "normalized", label: "NbE", mode: yap, enabled: () => config.evaluate },
		],
	},
	{
		key: "verification",
		label: "Verification",
		tabs: [
			{ key: "ivl", label: "IVL", mode: smtlib },
			{ key: "solverTrace", label: "Solver trace", mode: null },
		],
	},
	{
		key: "ir",
		label: "IR",
		tabs: [
			{ key: "gram", label: "GRAM", mode: gram },
			{ key: "gramDot", label: "DOT", mode: null },
			{ key: "mir", label: "MIR", mode: mir },
			{ key: "interpreted", label: "MIR result", mode: null, enabled: () => config.interpret },
		],
	},
	{
		key: "codegen",
		label: "Codegen",
		tabs: [
			{ key: "codegenJS", label: "JS", mode: javascript },
			{ key: "codegenC", label: "C", mode: c },
			{ key: "codegenErlang", label: "Erlang", mode: erlang },
		],
	},
];

const tabs = group => group.tabs.filter(tab => !tab.enabled || tab.enabled());

// ── State ──

let data = {};
let activeTab = "parsed";
let activeGroup = "typechecker";
let outputView = null;

const saved = JSON.parse(localStorage.getItem("yap-explore-config") || "{}");
const config = {
	parser: saved.parser || "Ann",
	deBruijn: saved.deBruijn || "off",
	raw: saved.raw || false,
	ivlSimplify: saved.ivlSimplify !== false,
	evaluate: saved.evaluate || false,
	interpret: saved.interpret || false,
	sidebarOpen: saved.sidebarOpen !== false,
};

const persist = () => localStorage.setItem("yap-explore-config", JSON.stringify(config));

// ── DOM refs ──

const $ = id => document.getElementById(id);
const $groups = $("groups");
const $tabs = $("tabs");
const $output = $("output");
const $errors = $("errors");
const $outputValue = $("output-value");
const $outputType = $("output-type");
const $outputValidity = $("output-validity");
const $status = $("status");
const $runBtn = $("run-btn");
const $sidebar = $("sidebar");
const $rawToggle = $("raw-toggle");
const $rawPanel = $("raw-panel");
const $rawContent = $("raw-content");
const $cfgParser = $("cfg-parser");
const $cfgDb = $("cfg-debruijn");
const $cfgRaw = $("cfg-raw");
const $cfgIvlSimplify = $("cfg-ivl-simplify");
const $cfgEvaluate = $("cfg-evaluate");
const $cfgInterpret = $("cfg-interpret");
const $sidebarToggle = $("sidebar-toggle");
const $cfgSnippet = $("cfg-snippet");

// ── Snippets UI ──

const buildSnippetSelect = () => {
	const groups = {};
	SNIPPETS.forEach(s => (groups[s.group] ??= []).push(s));
	Object.entries(groups).forEach(([name, items]) => {
		const og = document.createElement("optgroup");
		og.label = name;
		items.forEach(s => {
			const opt = document.createElement("option");
			opt.value = s.id;
			opt.textContent = s.label;
			og.appendChild(opt);
		});
		$cfgSnippet.appendChild(og);
	});
};

buildSnippetSelect();

// ── Sidebar ──

const applySidebar = () => {
	$sidebar.classList.toggle("hidden", !config.sidebarOpen);
	$sidebarToggle.textContent = config.sidebarOpen ? "Config ✕" : "Config";
};

$sidebarToggle.onclick = () => {
	config.sidebarOpen = !config.sidebarOpen;
	persist();
	applySidebar();
};
$cfgParser.value = config.parser;
$cfgDb.value = config.deBruijn;
$cfgRaw.checked = config.raw;
$cfgIvlSimplify.checked = config.ivlSimplify;
$cfgEvaluate.checked = config.evaluate;
$cfgInterpret.checked = config.interpret;
$cfgIvlSimplify.onchange = () => {
	config.ivlSimplify = $cfgIvlSimplify.checked;
	persist();
};
$cfgParser.onchange = () => {
	config.parser = $cfgParser.value;
	persist();
};
$cfgDb.onchange = () => {
	config.deBruijn = $cfgDb.value;
	persist();
};
$cfgRaw.onchange = () => {
	config.raw = $cfgRaw.checked;
	persist();
	updateRawPanel();
};
$cfgEvaluate.onchange = () => {
	config.evaluate = $cfgEvaluate.checked;
	persist();
	renderTabs();
};
$cfgInterpret.onchange = () => {
	config.interpret = $cfgInterpret.checked;
	persist();
	renderTabs();
};
applySidebar();

// ── Output editor ──

const mkReadonly = (content, mode) => {
	const extensions = [
		basicSetup,
		oneDark,
		EditorView.editable.of(false),
		EditorView.theme({
			"&": { height: "100%", fontSize: "13px" },
			".cm-scroller": { overflow: "auto" },
			".cm-gutters": { background: "var(--surface)", border: "none" },
		}),
	];

	if (mode) {
		extensions.push(StreamLanguage.define(mode));
	}
	return new EditorView({ doc: content, extensions, parent: $output });
};

// ── Tabs ──

const renderTabs = () => {
	$groups.innerHTML = "";
	GROUPS.forEach(group => {
		const btn = document.createElement("button");
		btn.className = "group" + (group.key === activeGroup ? " active" : "");
		btn.textContent = group.label;
		btn.onclick = () => {
			activeGroup = group.key;
			activeTab = tabs(group)[0].key;
			renderTabs();
			renderOutput();
		};
		$groups.appendChild(btn);
	});

	const group = GROUPS.find(({ key }) => key === activeGroup);
	const visibleTabs = tabs(group);
	if (!visibleTabs.some(({ key }) => key === activeTab)) {
		activeTab = visibleTabs[0].key;
	}

	$tabs.innerHTML = "";
	visibleTabs.forEach(({ key, label }) => {
		const btn = document.createElement("button");
		btn.className = "tab" + (key === activeTab ? " active" : "") + (data[key] ? " has-content" : "");
		btn.textContent = label;
		btn.onclick = () => {
			activeTab = key;
			renderTabs();
			renderOutput();
		};
		$tabs.appendChild(btn);
	});
};

const renderOutput = () => {
	$output.innerHTML = "";
	if (outputView) {
		outputView.destroy();
		outputView = null;
	}

	const content = data[activeTab] || "";
	if (!content) {
		$output.innerHTML = '<p class="empty">No output yet. Write some Yap and hit Run.</p>';
	} else {
		const tabCfg = GROUPS.flatMap(tabs).find(t => t.key === activeTab);
		outputView = mkReadonly(content, tabCfg?.mode || null);
	}
	updateRawPanel();
};

// ── Raw JSON panel ──

const updateRawPanel = () => {
	const hasRaw = config.raw && data.raw && data.raw[activeTab];
	$rawToggle.classList.toggle("hidden", !hasRaw);
	$rawPanel.classList.toggle("hidden", !hasRaw);
	if (hasRaw) {
		$rawContent.querySelector("pre").textContent = JSON.stringify(data.raw[activeTab], null, 2);
	}
};

let rawExpanded = false;
$rawToggle.onclick = () => {
	rawExpanded = !rawExpanded;
	$rawContent.classList.toggle("collapsed", !rawExpanded);
	$rawToggle.textContent = rawExpanded ? "Raw JSON ▾" : "Raw JSON ▸";
};

// ── Errors ──

const renderSummary = () => {
	$outputValue.textContent = data.output || "—";
	$outputType.textContent = data.type || "—";
	$outputValidity.textContent = data.validity || "—";
};

const renderErrors = errors => {
	if (!errors || errors.length === 0) {
		$errors.classList.add("hidden");
		return;
	}
	$errors.classList.remove("hidden");
	$errors.querySelector("pre").textContent = errors.join("\n\n");
};

// ── Execute ──

const execute = async () => {
	const source = editor.state.doc.toString();

	if (!source.trim()) {
		return;
	}

	$status.textContent = "Running...";
	$status.className = "status";
	$runBtn.disabled = true;

	try {
		const res = await fetch("/run", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				source,
				deBruijn: config.deBruijn,
				parserRule: config.parser,
				rawJson: config.raw,
				ivlSimplify: config.ivlSimplify,
				evaluate: config.evaluate,
				interpret: config.interpret,
			}),
		});
		data = await res.json();
		const n = data.errors?.length || 0;
		$status.textContent = n ? `Done (${n} error${n > 1 ? "s" : ""})` : "Done";
		$status.className = "status " + (n ? "error" : "ok");
		renderTabs();
		renderSummary();
		renderOutput();
		renderErrors(data.errors);
	} catch (e) {
		console.error(e);
		$status.textContent = "Request failed";
		$status.className = "status error";
		renderErrors([String(e)]);
	} finally {
		$runBtn.disabled = false;
	}
};

// ── Editor ──

const editor = new EditorView({
	doc: "(\\x -> x) 42",
	extensions: [
		basicSetup,
		oneDark,
		StreamLanguage.define(yap),
		EditorView.domEventHandlers({
			keydown: e => {
				if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
					e.preventDefault();
					execute();
					return true;
				}
			},
		}),
		EditorView.theme({
			"&": { height: "100%", fontSize: "14px" },
			".cm-scroller": { overflow: "auto" },
			".cm-content": { fontFamily: "var(--font)" },
		}),
	],
	parent: $("editor"),
});

$runBtn.onclick = execute;

$cfgSnippet.onchange = () => {
	const s = SNIPPETS.find(s => s.id === $cfgSnippet.value);
	if (s) {
		editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: s.code } });
	}
};

renderTabs();
renderSummary();
renderOutput();
