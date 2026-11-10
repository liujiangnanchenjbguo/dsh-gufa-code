/**
 * 58b-drag-ref：把 dsh-drag-ref 的「拖动文件到输入框 → @引用」「复制代码选区 →
 * 代码引用」「粘贴引用 chip」「点击 chip 跳回代码」整合进古法编程客户端。
 */
G.installGufaRefBridge = function installGufaRefBridge(ctx) {
	if (typeof document === "undefined") return () => {}
const DRAG_TYPE = "application/x-dsh-explorer-path";
		const CODE_REF_TYPE = "application/x-dsh-code-ref";
		const ROW = "[data-edrv-path]";
		const COMPOSER = "[data-conversation-region=\"composer\"]";
		const CHAT = "[data-conversation-content]";

		function toast(text, kind) {
  /* 只保留错误提示；复制/插入成功不再打扰用户 */
  if (kind !== "err") return;
  try { G.refToast(String(text), "err") } catch (_) {}
}

function activeSessionId() {
			const el = document.querySelector("[data-conversation-session]");
			const id = el === null ? null : el.getAttribute("data-conversation-session");
			return typeof id === "string" && id !== "" ? id : void 0;
		}

		function mentionOf(path) {
			const rel = String(path).replace(/\\/g, "/");
			if (/[\u0000-\u001f\u007f-\u009f"]/u.test(rel)) return "@" + path;
			return /\s/u.test(rel) ? `@"${rel}"` : "@" + rel;
		}

		function labelOf(path) {
			const parts = String(path).split(/[\\/]/);
			return parts[parts.length - 1] || String(path);
		}

		function rangeText(startLine, endLine) {
			if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return "";
			const a = Math.min(startLine, endLine);
			const b = Math.max(startLine, endLine);
			return a === b ? `${a} 行` : `${a}-${b} 行`;
		}

		function detectEnd(snapshot) {
			const total = String(snapshot && snapshot.draft !== void 0 ? snapshot.draft : "").length;
			const occurrences = snapshot && snapshot.occurrences;
			if (!Array.isArray(occurrences) || occurrences.length === 0) return total;
			let extra = 0;
			for (const item of occurrences) {
				const len = Number(item && item.length);
				if (Number.isFinite(len) && len > 1) extra += len - 1;
			}
			return Math.max(0, total - extra);
		}

		function caretOffset(input, fallback) {
			try {
				if (typeof input.caretSpan !== "function") return fallback;
				const span = input.caretSpan();
				const end = span ? Number(span.end) : NaN;
				if (!Number.isFinite(end)) return fallback;
				return Math.min(Math.max(0, end), fallback);
			} catch (_) {
				return fallback;
			}
		}

		function typeIntoComposer(text) {
			const editor = document.querySelector(COMPOSER + " [contenteditable=\"true\"]") || document.querySelector(COMPOSER);
			if (editor === null) return false;
			try {
				editor.focus();
				if (document.execCommand("insertText", false, text)) return true;
			} catch (_) {}
			try {
				const data = new DataTransfer();
				data.setData("text/plain", text);
				editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
				return true;
			} catch (_) {}
			return false;
		}

		/** Insert a file/folder reference (optionally with a line range). */
		function insertRef(ctx, info) {
			const isDir = info.isDir === true;
			const mention = mentionOf(info.path);
			const hasRange = !isDir && Number.isFinite(info.startLine) && Number.isFinite(info.endLine);
			const ref = hasRange
				? mention + (info.startLine === info.endLine ? ` L${info.startLine}` : ` L${Math.min(info.startLine, info.endLine)}-${Math.max(info.startLine, info.endLine)}`)
				: mention;
			const label = hasRange
				? labelOf(info.path) + " " + rangeText(info.startLine, info.endLine)
				: labelOf(info.path);
			const reference = {
				source: "reference",
				ref,
				label,
				appearance: isDir ? "folder" : "file",
				clipboardText: mention
			};
			let input = null;
			let reason = "";
			try {
				const sessions = ctx.get("sessions");
				const conversation = ctx.get("conversation");
				const sessionId = activeSessionId();
				if (sessionId === void 0) reason = "找不到当前会话 id";
				else if (sessions === void 0) reason = "sessions 服务不可用";
				else if (conversation === void 0) reason = "conversation 服务不可用";
				else {
					const actx = typeof sessions.scope === "function" ? sessions.scope(sessionId) : void 0;
					if (actx === void 0) reason = "sessions.scope(" + sessionId.slice(0, 12) + "…) 为空";
					else {
						input = conversation.input.for(actx);
						if (input === void 0) reason = "conversation.input.for(...) 为空";
					}
				}
			} catch (error) {
				reason = "门面解析异常：" + String(error && error.message || error);
			}
			if (input !== null && typeof input.state?.getSnapshot === "function") {
				try {
					const snapshot = input.state.getSnapshot();
					const offset = caretOffset(input, detectEnd(snapshot));
					const span = { start: offset, end: offset, draftRev: snapshot && snapshot.draftRev };
					if (typeof input.insertReference === "function" && input.insertReference(reference, span) === true) return { ok: true, via: "insertReference" };
					if (typeof input.insertText === "function" && input.insertText(mention + " ", span) === true) return { ok: true, via: "insertText" };
					reason = reason || "insertReference/insertText 都返回 false";
				} catch (error) {
					reason = "插入异常：" + String(error && error.message || error);
				}
			}
			if (info.text && typeIntoComposer(info.text)) return { ok: true, via: "composer-text" };
			if (typeIntoComposer(mention + " ")) return { ok: true, via: "composer" };
			return { ok: false, reason: reason || "输入框不可用" };
		}

		function isOurs(transfer) {
			if (transfer === null || transfer === void 0) return false;
			try {
				return Array.prototype.indexOf.call(transfer.types, DRAG_TYPE) !== -1;
			} catch (_) {
				return false;
			}
		}

		function payloadOf(transfer) {
			if (transfer === null || transfer === void 0) return null;
			try {
				const raw = transfer.getData(DRAG_TYPE);
				if (raw !== "") {
					const parsed = JSON.parse(raw);
					if (parsed && typeof parsed.path === "string" && parsed.path !== "") return parsed;
				}
			} catch (_) {}
			try {
				const text = transfer.getData("text/plain");
				if (text !== "") return { path: text, isDir: false };
			} catch (_) {}
			return null;
		}

		function hasCodeRef(clipboard) {
			if (clipboard === null || clipboard === void 0) return false;
			try {
				return Array.prototype.indexOf.call(clipboard.types, CODE_REF_TYPE) !== -1;
			} catch (_) {
				return false;
			}
		}

		function codeRefOf(clipboard) {
			try {
				const raw = clipboard.getData(CODE_REF_TYPE);
				if (raw === "") return null;
				const parsed = JSON.parse(raw);
				if (!parsed || typeof parsed.path !== "string" || parsed.path === "") return null;
				return parsed;
			} catch (_) {
				return null;
			}
		}

		function dropZoneOf(node) {
			if (!(node instanceof Element)) return null;
			return node.closest(COMPOSER) || node.closest(CHAT);
		}

		/** The focused Monaco editor (copy source). */
		function focusedEditor() {
			const monaco = window.monaco;
			if (!monaco || !monaco.editor || typeof monaco.editor.getEditors !== "function") return null;
			let editors = [];
			try {
				editors = monaco.editor.getEditors() || [];
			} catch (_) {
				return null;
			}
			for (const editor of editors) {
				try {
					if (editor && typeof editor.hasTextFocus === "function" && editor.hasTextFocus()) return editor;
				} catch (_) {}
			}
			return editors.length === 1 ? editors[0] : null;
		}

		/** File path + selected line range + selected text from one Monaco editor.
		 *  `fullLines` 只在选区完整覆盖整行时为真；不足一行或首尾带半行的选区
		 *  按普通文本复制，不生成代码引用。 */
		function editorSelectionOf(editor) {
  try {
    const model = editor.getModel();
    const selection = editor.getSelection();
    if (!model || !selection) return null;
    const text = model.getValueInRange(selection);
    if (!text) return null;
    const rawPath = model.uri && model.uri.path ? String(model.uri.path) : "";
    const absolute = decodeURIComponent(rawPath.replace(/^\//, ""));
    if (absolute === "") return null;
    /* gufa 的 model URI 是项目绝对路径；引用 chip 需要项目相对路径 */
    let path = absolute;
    try {
      const root = typeof G.projectRoot === "string" ? String(G.projectRoot).replace(/\/+$/, "") : "";
      const rootNoSlash = root.replace(/^\//, "");
      if (root !== "" && absolute.startsWith(root + "/")) path = absolute.slice(root.length + 1);
      else if (rootNoSlash !== "" && absolute.startsWith(rootNoSlash + "/")) path = absolute.slice(rootNoSlash.length + 1);
    } catch (_) {}
    if (path === "") return null;
    const startLine = Math.min(selection.startLineNumber, selection.endLineNumber);
    const endLine = Math.max(selection.startLineNumber, selection.endLineNumber);
    const startColumn = Math.min(selection.startColumn, selection.endColumn);
    const endColumn = Math.max(selection.startColumn, selection.endColumn);
    /* 单行：从行首选到行尾才算引用；多行：任意列都算引用。 */
    const fullLines = startLine !== endLine
      ? true
      : startColumn === 1 && endColumn === model.getLineMaxColumn(endLine);
    return { path, startLine, endLine, fullLines, text };
  } catch (_) {
    return null;
  }
}

function install(ctx) {
			loadRefs();
			const onDragStart = (event) => {
				const target = event.target;
				const row = target instanceof Element ? target.closest(ROW) : null;
				if (row === null || event.dataTransfer === null) return;
				const path = row.getAttribute("data-edrv-path");
				if (path === null || path === "") return;
				const chevron = row.querySelector(".edrv-tree-chev");
				const isDir = chevron !== null && (chevron.textContent || "").trim() !== "";
				event.dataTransfer.effectAllowed = "copy";
				event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ path, isDir }));
				event.dataTransfer.setData("text/plain", path);
			};
			const onDragOver = (event) => {
				if (!isOurs(event.dataTransfer) || dropZoneOf(event.target) === null) return;
				event.preventDefault();
				if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
			};
			const onDrop = (event) => {
				if (!isOurs(event.dataTransfer)) return;
				if (dropZoneOf(event.target) === null) {
					toast("松手位置不在输入框内，未插入", "err");
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				const payload = payloadOf(event.dataTransfer);
				if (payload === null) {
					return;
				}
				const result = insertRef(ctx, { path: payload.path, isDir: payload.isDir === true });
				if (result.ok) {
					insertedRefs.set(labelOf(payload.path), { path: payload.path, startLine: void 0, endLine: void 0 });
					saveRefs();
				}
			if (result.ok) toast("已插入引用：" + labelOf(payload.path), "ok");
				else toast("插入失败：" + result.reason, "err");
			};

			/** Copying a selection inside Monaco records the path + line range. */
			const onCopy = (event) => {
  const target = event.target;
  if (!(target instanceof Element) || target.closest(".monaco-editor") === null) return;
  const editor = focusedEditor();
  if (editor === null) return;
  const info = editorSelectionOf(editor);
  if (info === null) return;
  /* 引用判定：跨行选区一律算引用（哪怕首行/末行只选中半行）；
     单行必须完整整行选中，否则按普通文本复制。 */
  const multiLine = info.startLine !== info.endLine;
  if (!multiLine && info.fullLines !== true) return;
  try {
    event.preventDefault();
    event.stopPropagation();
    if (event.clipboardData !== null) {
      event.clipboardData.setData("text/plain", info.text);
      event.clipboardData.setData(CODE_REF_TYPE, JSON.stringify(info));
    }
  } catch (_) {}
};

const onPaste = (event) => {
				if (!hasCodeRef(event.clipboardData)) return;
				if (dropZoneOf(event.target) === null) return;
				const info = codeRefOf(event.clipboardData);
				if (info === null) return;
				event.preventDefault();
				event.stopPropagation();
				const result = insertRef(ctx, { path: info.path, startLine: info.startLine, endLine: info.endLine, text: info.text });
				if (result.ok) {
				insertedRefs.set(labelOf(info.path) + " " + rangeText(info.startLine, info.endLine), { path: info.path, startLine: info.startLine, endLine: info.endLine });
				saveRefs();
			}
			if (result.ok) toast("已插入代码引用：" + labelOf(info.path) + " " + rangeText(info.startLine, info.endLine), "ok");
				else toast("插入失败：" + result.reason, "err");
			};

			/**
			 * Clicking a reference chip re-opens the target and selects its line range.
			 * Only real chips are considered: a title chip, a Lexical decorator inside
			 * the composer, or an inline leaf whose text matches a known chip label.
			 * Message containers and the editable root never match.
			 */
			const onReferenceClick = (event) => {
				const target = event.target;
				if (!(target instanceof Element)) return;
				let info = null;

				/* 1) chip carrying a title (`@path L12-34` or `@path`). */
				const titleChip = target.closest("[title^=\"@\"]");
				if (titleChip !== null) {
					const chipText = (titleChip.textContent || "").trim();
					if (chipText.length > 80) return;
					const title = (titleChip.getAttribute("title") || "").trim();
					if (/^@(?:"[^"\n]+"|\S+)(?:\s+L\d+(?:-\d+)?)?$/u.test(title)) info = parseRefText(title);
					if (info === null && chipText !== "") info = insertedRefs.get(chipText) || null;
					if (info !== null && (info.startLine === void 0 || info.endLine === void 0)) {
						const sibling = titleChip.nextSibling;
						const tail = sibling !== null && sibling.nodeType === 3 ? sibling.textContent : "";
						const range = /^\s*L(\d+)(?:-(\d+))?/u.exec(String(tail || ""));
						if (range) {
							info.startLine = Number(range[1]);
							info.endLine = range[2] === void 0 ? info.startLine : Number(range[2]);
						}
					}
				} else {
					/* 2) Lexical decorator chip inside the composer (no title attribute). */
					const decorator = target.closest("[data-lexical-decorator=\"true\"], [contenteditable=\"false\"]");
					if (decorator !== null && decorator.closest("[data-conversation-region=\"composer\"]") !== null) {
						const label = (decorator.textContent || "").trim();
						if (label === "" || label.length > 80) return;
						info = insertedRefs.get(label) || null;
					} else {
						/* 3) inline leaf fallback (never the editable root or a block container). */
						if (target.getAttribute && target.getAttribute("contenteditable") === "true") return;
						try {
							const display = getComputedStyle(target).display;
							if (display !== "inline" && display !== "inline-flex" && display !== "inline-block") return;
						} catch (_) { return; }
						if (target.childElementCount > 0) return;
						const text = (target.textContent || "").trim();
						if (text === "" || text.length > 80) return;
						info = insertedRefs.get(text) || null;
					}
				}

				if (info === null || info.path === void 0 || info.path === "") return;
				if (info.startLine === void 0 || info.endLine === void 0) return;
				event.preventDefault();
				event.stopPropagation();
				openAtRange(ctx, info.path, info.startLine, info.endLine);
			};

			const mark = (root) => {
				const rows = root && typeof root.querySelectorAll === "function" ? root.querySelectorAll(ROW) : [];
				for (const row of rows) {
					if (row.getAttribute("draggable") !== "true") row.setAttribute("draggable", "true");
				}
			};

			document.addEventListener("dragstart", onDragStart, true);
			document.addEventListener("dragover", onDragOver, true);
			document.addEventListener("drop", onDrop, true);
			document.addEventListener("click", onReferenceClick, true);
			document.addEventListener("copy", onCopy, true);
			document.addEventListener("paste", onPaste, true);
			mark(document);
			const observer = new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					for (const node of mutation.addedNodes) {
						if (!(node instanceof Element)) continue;
						if (node.matches(ROW)) node.setAttribute("draggable", "true");
						mark(node);
					}
				}
			});
			observer.observe(document.body, { childList: true, subtree: true });

			return () => {
				document.removeEventListener("dragstart", onDragStart, true);
				document.removeEventListener("dragover", onDragOver, true);
				document.removeEventListener("drop", onDrop, true);
				document.removeEventListener("click", onReferenceClick, true);
				document.removeEventListener("copy", onCopy, true);
				document.removeEventListener("paste", onPaste, true);
				observer.disconnect();
			};
		}

				/** Inserted references by chip label, for chips that carry no title attribute. */
		const insertedRefs = new Map();
		const REF_STORE_KEY = "gufa-code.refs.v1";

		/** Restore label → {path,startLine,endLine} from localStorage (drafts survive restarts). */
		function loadRefs() {
			try {
				const raw = localStorage.getItem(REF_STORE_KEY);
				if (raw === null) return;
				const parsed = JSON.parse(raw);
				if (parsed === null || typeof parsed !== "object") return;
				for (const label of Object.keys(parsed)) {
					const info = parsed[label];
					if (info && typeof info.path === "string" && info.path !== "") insertedRefs.set(label, info);
				}
			} catch (_) {}
		}

		/** Persist the label map so chips restored from a draft still resolve after a restart. */
		function saveRefs() {
			try {
				const out = {};
				let count = 0;
				for (const [label, info] of insertedRefs) {
					out[label] = info;
					if (++count >= 300) break;
				}
				localStorage.setItem(REF_STORE_KEY, JSON.stringify(out));
			} catch (_) {}
		}

		/** Parse `@path L12-34` / `@"a b" L12` into { path, startLine, endLine }. */
		function parseRefText(text) {
			const raw = String(text == null ? "" : text).trim();
			if (!raw.startsWith("@")) return null;
			let body = raw.slice(1);
			let path = "";
			if (body.startsWith('"')) {
				const end = body.indexOf('"', 1);
				if (end < 0) return null;
				path = body.slice(1, end);
				body = body.slice(end + 1);
			} else {
				const space = body.indexOf(" ");
				path = space < 0 ? body : body.slice(0, space);
				body = space < 0 ? "" : body.slice(space);
			}
			if (path === "") return null;
			const range = /^\s*L(\d+)(?:-(\d+))?\s*$/u.exec(body);
			if (!range) return { path, startLine: void 0, endLine: void 0 };
			const start = Number(range[1]);
			const end = range[2] === void 0 ? start : Number(range[2]);
			return { path, startLine: start, endLine: end };
		}

		/** Find the Monaco model for one workspace-relative path. */
		function modelFor(path) {
			const monaco = window.monaco;
			if (!monaco || !monaco.editor || typeof monaco.editor.getModels !== "function") return null;
			let models = [];
			try { models = monaco.editor.getModels() || []; } catch (_) { return null; }
			const wanted = String(path).replace(/\\/g, "/").replace(/^\.\//, "");
			for (const model of models) {
				const raw = model && model.uri && model.uri.path ? String(model.uri.path) : "";
				const candidate = decodeURIComponent(raw.replace(/^\//, ""));
				if (candidate === wanted || candidate.endsWith("/" + wanted) || wanted.endsWith("/" + candidate)) return model;
			}
			return null;
		}

		/** Select the line range once the editor for that file is mounted. */
		function selectRange(path, startLine, endLine) {
			const start = Number(startLine);
			const end = Number(endLine) || start;
			if (!Number.isFinite(start) || start <= 0) return;
			const deadline = Date.now() + 4000;
			const tick = () => {
				const monaco = window.monaco;
				const model = modelFor(path);
				if (monaco && model) {
					let editors = [];
					try { editors = monaco.editor.getEditors() || []; } catch (_) {}
					const editor = editors.find((item) => item.getModel && item.getModel() === model);
					if (editor) {
						try {
							const range = new monaco.Range(start, 1, end, 1);
							if (typeof editor.setSelection === "function") editor.setSelection(range);
							if (typeof editor.revealRangeInCenter === "function") editor.revealRangeInCenter(range);
							else if (typeof editor.revealLineInCenter === "function") editor.revealLineInCenter(start);
							if (typeof editor.focus === "function") editor.focus();
						} catch (_) {}
						return;
					}
				}
				if (Date.now() < deadline) setTimeout(tick, 120);
			};
			tick();
		}

		/** Open a file through the official resource route (falls back to workspaces.openPath). */
		function openAtRange(ctx, path, startLine, endLine) {
			try {
				if (G.bus !== null && G.bus !== undefined && typeof G.bus.emit === "function") {
					G.bus.emit("editor:open-at", { path, line: Number(startLine) || 1, column: 1 });
					selectRange(path, startLine, endLine);
					return;
				}
			} catch (_) {}
			try {
				const sessionId = activeSessionId();
				const sidebarRight = ctx.get("sidebarRight");
				if (sessionId !== void 0 && sidebarRight !== void 0 && typeof sidebarRight.openResource === "function") {
					const address = "dsh-resource://file/session/" + encodeURIComponent(sessionId) + "/" + String(path).replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/");
					sidebarRight.openResource(address, { params: { line: Number(startLine) || 1 } });
				} else {
					const workspaces = ctx.get("workspaces");
					if (workspaces !== void 0 && typeof workspaces.openPath === "function") workspaces.openPath(path);
				}
			} catch (_) {
				try {
					const workspaces = ctx.get("workspaces");
					if (workspaces !== void 0 && typeof workspaces.openPath === "function") workspaces.openPath(path);
				} catch (_) {}
			}
			selectRange(path, startLine, endLine);
		}

		
	return install(ctx)
}
