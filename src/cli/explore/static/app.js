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

// ── Tab config ──

const TABS = [
	{ key: "parsed", label: "Parsed", mode: yap },
	{ key: "elaborated", label: "Elaborated", mode: yap },
	{ key: "type", label: "Type", mode: yap },
	{ key: "normalized", label: "NF", mode: yap },
	{ key: "constraints", label: "Constraints", mode: null },
	{ key: "metas", label: "Metas", mode: null },
	{ key: "verification", label: "Verify", mode: smtlib },
	{ key: "mir", label: "MIR", mode: mir },
	{ key: "gram", label: "GRAM", mode: gram },
	{ key: "codegenJS", label: "JS", mode: javascript },
	{ key: "codegenC", label: "C", mode: c },
	{ key: "codegenErlang", label: "Erlang", mode: erlang },
];

// ── State ──

let data = {};
let activeTab = "parsed";
let outputView = null;

const saved = JSON.parse(localStorage.getItem("yap-explore-config") || "{}");
const config = {
	parser: saved.parser || "Ann",
	deBruijn: saved.deBruijn || "off",
	raw: saved.raw || false,
	vcFormat: saved.vcFormat || "pretty",
	sidebarOpen: saved.sidebarOpen !== false,
};

const persist = () => localStorage.setItem("yap-explore-config", JSON.stringify(config));

// ── DOM refs ──

const $ = id => document.getElementById(id);
const $tabs = $("tabs");
const $output = $("output");
const $errors = $("errors");
const $status = $("status");
const $runBtn = $("run-btn");
const $sidebar = $("sidebar");
const $rawToggle = $("raw-toggle");
const $rawPanel = $("raw-panel");
const $rawContent = $("raw-content");
const $cfgParser = $("cfg-parser");
const $cfgDb = $("cfg-debruijn");
const $cfgRaw = $("cfg-raw");
const $cfgVcFormat = $("cfg-vc-format");
const $sidebarToggle = $("sidebar-toggle");

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
$cfgVcFormat.value = config.vcFormat;
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
$cfgVcFormat.onchange = () => {
	config.vcFormat = $cfgVcFormat.value;
	persist();
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
	$tabs.innerHTML = "";
	TABS.forEach(({ key, label }) => {
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
		const tabCfg = TABS.find(t => t.key === activeTab);
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
				vcFormat: config.vcFormat,
			}),
		});
		data = await res.json();
		const n = data.errors?.length || 0;
		$status.textContent = n ? `Done (${n} error${n > 1 ? "s" : ""})` : "Done";
		$status.className = "status " + (n ? "error" : "ok");
		renderTabs();
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

renderTabs();
renderOutput();
