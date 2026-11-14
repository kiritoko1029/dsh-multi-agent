import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { currentTaskTrace } from "../task-monitor.js";
import { codexWrapperArgv } from "./codex-command.js";
import { JsonRpcLineTransport } from "./json-rpc-line-transport.js";
import { createPermissionAsker, normalizePermissionPolicy, normalizeSubagentPermissionMode, resolveMainSessionFullAccess } from "./permission-policy.js";
import { sameDirectory } from "./path-compat.js";
import { assertDirectCommand } from "./process-command.js";
import { NO_START_CAPABILITIES, assertPositiveFinite, assertUsableCwd, settleRunResult, subprocessRunHandle } from "./provider-process-contract.js";

/*
 * Adapted from @deepseek-ai/dsh-subagent-codex 0.2.2-rc.1 lib/index.js.
 * Source: https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/subagent/subagent-codex
 *
 * MIT License
 * Copyright (c) 2026 DeepSeek
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
const MAX_TIMER_DELAY_MS = 2147483647;
//#region lib/types/wire.js
/**
* Minimal Codex app-server 0.153.4 protocol adapter. The shared JSON-RPC
* transport owns framing and request correlation; this module owns only the
* product methods, current thread/turn association, unattended approval
* responses, and terminal-answer selection.
*
* @module @deepseek-ai/dsh-subagent-codex/wire
*/
const THREAD_PERMISSION_PARAMS = {
	never: { approvalPolicy: "never" },
	"approve-for-me": {
		approvalPolicy: "on-request",
		approvalsReviewer: "auto_review",
		sandbox: "workspace-write"
	},
	"dangerously-bypass-approvals-and-sandbox": {
		approvalPolicy: "never",
		sandbox: "danger-full-access"
	},
	// Interactive adapter mode: the thread keeps the workspace-write sandbox
	// but every escalation reaches this client instead of an auto reviewer,
	// so the selected permission policy decides real requests.
	"ask-request": {
		approvalPolicy: "on-request",
		sandbox: "workspace-write"
	}
};
/**
* Map the configured thread mode and the plugin permission policy onto the
* thread the app-server actually starts.
* @param permissionMode - configured Codex native mode.
* @param permissionPolicy - plugin permission policy (normalized).
* @param subagentMode - sub-agent control level (normalized).
* @param mainSessionFullAccess - run-start snapshot of the native full preset.
* @returns the thread permission mode for {@link THREAD_PERMISSION_PARAMS}.
*/
function effectiveCodexThreadMode(permissionMode, permissionPolicy, subagentMode, mainSessionFullAccess = false) {
	if (permissionPolicy === "main-session" && mainSessionFullAccess) return "dangerously-bypass-approvals-and-sandbox";
	if (permissionPolicy === "main-session" || permissionPolicy === "human" || permissionPolicy === "allow") return "ask-request";
	if (permissionPolicy === "subagent") {
		if (subagentMode === "full-access") return "dangerously-bypass-approvals-and-sandbox";
		if (subagentMode === "ask-request") return "ask-request";
		// auto defers to the sub-agent's own system: the user's configured
		// native mode (never / approve-for-me / bypass) applies unchanged.
		return THREAD_PERMISSION_PARAMS[permissionMode] === void 0 ? "approve-for-me" : permissionMode;
	}
	return THREAD_PERMISSION_PARAMS[permissionMode] === void 0 ? "never" : permissionMode;
}
function object(value, label) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`subagent-codex: app-server returned invalid ${label}`);
	return value;
}
function string(value, label) {
	if (typeof value !== "string" || value.length === 0) throw new Error(`subagent-codex: app-server returned invalid ${label}`);
	return value;
}
/**
* Human-readable command summary for one command approval request.
* @param params - `item/commandExecution/requestApproval` payload.
*/
function commandApprovalTitle(params) {
	const command = Array.isArray(params.command) ? params.command.filter((part) => typeof part === "string") : [];
	const parts = [];
	if (command.length > 0) parts.push(`$ ${command.join(" ")}`);
	if (typeof params.cwd === "string" && params.cwd) parts.push(`cwd: ${params.cwd}`);
	if (parts.length > 0) return parts.join(" · ");
	return "Codex command execution";
}
/**
* Human-readable file-change summary for one file approval request.
* @param params - `item/fileChange/requestApproval` payload.
*/
function fileChangeApprovalTitle(params) {
	const change = params.change;
	if (change !== null && typeof change === "object") {
		const path2 = typeof change.path === "string" && change.path ? change.path : void 0;
		const kind2 = typeof change.kind === "string" && change.kind ? change.kind : void 0;
		const parts = [kind2 ?? "file change"];
		if (path2 !== void 0) parts.push(path2);
		if (parts.length > 1 || kind2 !== void 0) return parts.join(": ");
	}
	return "Codex file change";
}
/**
* Short label for one permissions approval request.
* @param params - `item/permissions/requestApproval` payload.
*/
function permissionsApprovalTitle(params) {
	return "Codex additional turn permissions";
}
/**
* Bounded JSON preview of the requested permissions.
* @param params - `item/permissions/requestApproval` payload.
*/
function permissionsApprovalDetail(params) {
	try {
		const requested = params.permissions ?? params.additionalPermissions;
		if (requested === void 0 || requested === null) return permissionsApprovalTitle(params);
		const text = JSON.stringify(requested);
		return typeof text === "string" && text.length <= 600 ? text : `${text.slice(0, 599)}…`;
	} catch {
		return permissionsApprovalTitle(params);
	}
}
/**
* Build the refusal decision for an explicit denial. Prefers `decline`;
* `cancel` only when the server offers neither. Never throws: a denial must
* stay answerable even for unexpected option sets.
* @param params - one approval request payload.
* @returns the wire decision string.
*/
function deniedDecision(params) {
	const available = params.availableDecisions;
	if (Array.isArray(available)) {
		if (available.includes("decline")) return "decline";
		if (available.includes("cancel")) return "cancel";
	}
	return "decline";
}
/**
* Whether the server accepts a plain `accept` for one approval request.
* Amendment-only offers cannot be echoed back safely and stay declined.
* @param params - one approval request payload.
*/
function offersPlainAccept(params) {
	const available = params.availableDecisions;
	return available === void 0 || available === null || Array.isArray(available) && available.includes("accept");
}
function numericHttpStatus(value) {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 65535 ? value : void 0;
}
function objectFailureInfo(value) {
	const keys = Object.keys(value);
	const category = keys[0];
	if (keys.length !== 1 || category === void 0) return { category: "unknown" };
	const detail = value[category];
	if (detail === null || typeof detail !== "object" || Array.isArray(detail)) return { category: "unknown" };
	const fields = detail;
	switch (category) {
		case "httpConnectionFailed":
		case "responseStreamConnectionFailed":
		case "responseStreamDisconnected":
		case "responseTooManyFailedAttempts": {
			const httpStatus = numericHttpStatus(fields.httpStatusCode);
			return httpStatus === void 0 ? { category: "transport" } : {
				category: "transport",
				httpStatus
			};
		}
		case "activeTurnNotSteerable": return { category: "product-error" };
		default: return { category: "unknown" };
	}
}
function failureInfo(turn) {
	if (turn.status !== "failed") return { category: "unknown" };
	const error = turn.error;
	if (error === null || typeof error !== "object" || Array.isArray(error)) return { category: "unknown" };
	const info = error.codexErrorInfo;
	if (typeof info === "string") switch (info) {
		case "contextWindowExceeded": return {
			category: "limit",
			maxTokens: true
		};
		case "sessionBudgetExceeded":
		case "usageLimitExceeded": return { category: "limit" };
		case "serverOverloaded":
		case "internalServerError": return { category: "service" };
		case "cyberPolicy":
		case "misalignmentPolicyViolation":
		case "unauthorized": return { category: "access-policy" };
		case "badRequest":
		case "threadRollbackFailed":
		case "other": return { category: "product-error" };
		case "sandboxError": return {
			category: "access-policy",
			sandboxFailure: true
		};
		default: return { category: "unknown" };
	}
	return info !== null && typeof info === "object" && !Array.isArray(info) ? objectFailureInfo(info) : { category: "unknown" };
}
function unattendedDiagnostic(mode, request, decision, reason) {
	return `Codex unattended decision (mode: ${mode}; request: ${request}; decision: ${decision}): ${reason}`;
}
function thrown$1(value) {
	/* v8 ignore next -- typed protocol and stream failures reject with Error. */
	return value instanceof Error ? value : new Error(String(value));
}
function abortError(signal) {
	return signal.reason instanceof Error ? signal.reason : /* @__PURE__ */ new Error(`subagent-codex: app-server request aborted: ${String(signal.reason)}`);
}
async function raceAbort(pending, signal) {
	if (signal.aborted) {
		pending.catch(() => {});
		throw abortError(signal);
	}
	let rejectAbort;
	const aborted = new Promise((_resolve, reject) => {
		rejectAbort = reject;
	});
	const onAbort = () => {
		rejectAbort(abortError(signal));
	};
	signal.addEventListener("abort", onAbort, { once: true });
	try {
		return await Promise.race([pending, aborted]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}
/**
* One app-server connection and its single ephemeral thread/turn.
*
* The class deliberately exposes no generic request surface. Supporting
* another product method must first become part of the provider contract.
*/
var CodexAppServerWire = class {
	input;
	permissionMode;
	model;
	transport;
	fatal = Promise.withResolvers();
	threadId;
	turnId;
	pendingTurnId;
	turnCompleted;
	earlyTurnNotifications = [];
	lastFinalAnswer;
	lastPartialAnswer;
	lastUnphasedAnswer;
	diagnostic;
	failure;
	diagnosticOrder = 0;
	observationOrder = 0;
	pendingDiagnostic;
	inputEnded = false;
	terminalObserved = false;
	closed = false;
	constructor(input, output, permissionMode, model, approval) {
		this.input = input;
		this.permissionMode = permissionMode;
		this.model = model;
		this.approval = approval;
		this.transport = new JsonRpcLineTransport(input, output);
		this.fatal.promise.catch(() => {});
		this.transport.onRequest((method, params) => this.handleServerRequest(method, params));
		this.transport.onNotification((method, params) => {
			try {
				this.handleNotification(method, params);
			} catch (error) {
				this.fail(thrown$1(error));
			}
		});
		this.input.on("error", this.onInputError);
		this.input.on("end", this.onInputEnd);
		output.on("error", this.onOutputError);
	}
	/** Start reading app-server frames. */
	start() {
		this.transport.start();
	}
	/**
	* Whether protocol output ended before a terminal turn notification.
	* @returns `true` only for an early protocol close without a terminal turn.
	*/
	endedBeforeTerminal() {
		return this.inputEnded && !this.terminalObserved;
	}
	/**
	* Perform the required app-server initialize/initialized handshake.
	* @param signal - unpublished-start cancellation.
	*/
	async initialize(signal) {
		object(await this.guarded(this.transport.request("initialize", {
			clientInfo: {
				name: "deepseek-harness",
				title: "DeepSeek Harness",
				version: "0.0.1"
			},
			capabilities: {
				experimentalApi: false,
				requestAttestation: false
			}
		}, signal), signal), "initialize response");
		this.transport.notify("initialized");
		await this.guarded(this.transport.flush(), signal);
	}
	/**
	* Create the run's private ephemeral thread and retain its identity.
	* @param cwd - selected child working directory.
	* @param signal - unpublished-start cancellation.
	*/
	async startThread(cwd, signal) {
		const thread = object(object(await this.guarded(this.transport.request("thread/start", {
			cwd,
			ephemeral: false,
			...this.model === void 0 ? {} : { model: this.model },
			...THREAD_PERMISSION_PARAMS[this.permissionMode]
		}, signal), signal), "thread/start response").thread, "thread/start thread");
		const id = string(thread.id, "thread/start thread id");
		if (thread.ephemeral !== false) throw new Error("subagent-codex: app-server did not create a persistent thread");
		this.threadId = id;
		return id;
	}
	async resumeThread(threadId, cwd, signal) {
		const thread = object(object(await this.guarded(this.transport.request("thread/resume", {
			threadId,
			cwd,
			excludeTurns: true,
			...THREAD_PERMISSION_PARAMS[this.permissionMode]
		}, signal), signal), "thread/resume response").thread, "thread/resume thread");
		const id = string(thread.id, "thread/resume thread id");
		if (id !== threadId) throw new Error("subagent-codex: app-server resumed a different thread");
		if (thread.ephemeral !== false) throw new Error("subagent-codex: app-server resumed an ephemeral thread");
		if (thread.cwd !== void 0 && !sameDirectory(thread.cwd, cwd)) throw new Error("subagent-codex: app-server resumed a thread with a different cwd");
		this.threadId = id;
		return id;
	}
	/**
	* Submit the one text-only task and wait for this thread/turn's authoritative
	* terminal notification.
	* @param texts - already validated task text blocks.
	* @param signal - local cancellation for the published run.
	* @returns the shared subagent result.
	*/
	async runTurn(texts, signal, effort) {
		const completion = Promise.withResolvers();
		this.turnCompleted = completion;
		const threadId = this.threadId;
		try {
			const turn = object(object(await this.guarded(this.transport.request("turn/start", {
				threadId,
				...effort === void 0 ? {} : { effort },
				input: texts.map((text) => ({
					type: "text",
					text,
					text_elements: []
				}))
			}, signal), signal), "turn/start response").turn, "turn/start turn");
			this.commitTurnId(string(turn.id, "turn/start turn id"));
		} catch (error) {
			this.recordFailure({
				stage: "turn-start",
				category: "unknown"
			});
			throw error;
		}
		let completed;
		let terminal;
		try {
			completed = await this.guarded(completion.promise, signal);
			terminal = object(completed.params.turn, "turn/completed turn");
		} catch (error) {
			this.recordFailure({
				stage: "turn",
				category: "unknown"
			});
			throw error;
		}
		const status = terminal.status;
		if (status !== "completed") {
			const parsed = failureInfo(terminal);
			this.recordFailure(parsed.httpStatus === void 0 ? {
				stage: "turn",
				category: parsed.category
			} : {
				stage: "turn",
				category: parsed.category,
				httpStatus: parsed.httpStatus
			});
			if (parsed.sandboxFailure) this.recordDiagnostic("sandbox execution", "failed", "Codex reported a sandbox failure", completed.order);
			if (parsed.maxTokens) return {
				output: this.collectOutput(),
				stopReason: "max-tokens"
			};
			const detail = status === "failed" ? `: ${parsed.category}` : "";
			throw new Error(`subagent-codex: Codex turn ended with status ${String(status)}${detail}`);
		}
		const output = this.collectOutput();
		if (output.length === 0) {
			this.recordFailure({
				stage: "turn",
				category: "invalid-result"
			});
			throw new Error("subagent-codex: Codex completed without an answer");
		}
		return {
			output,
			stopReason: "completed"
		};
	}
	/**
	* Best-effort remote cancellation. Local settlement and process teardown
	* remain authoritative when the child no longer accepts protocol requests.
	*/
	interrupt() {
		if (this.threadId === void 0 || this.turnId === void 0 || this.closed) return;
		this.transport.request("turn/interrupt", {
			threadId: this.threadId,
			turnId: this.turnId
		}).catch(() => {});
	}
	/**
	* The best non-commentary answer observed so far, preserving exact bytes:
	* the latest `final_answer`, else the latest `partial_answer`, else the
	* latest nullable-phase message.
	* @returns the selected text block, if any.
	*/
	collectOutput() {
		const selected = this.lastFinalAnswer ?? this.lastPartialAnswer ?? this.lastUnphasedAnswer;
		return selected !== void 0 && selected.trim().length > 0 ? [{
			type: "text",
			text: selected
		}] : [];
	}
	/**
	* The latest safe unattended permission fact observed for this run.
	* @returns provider-authored diagnostic text, when one was observed.
	*/
	collectDiagnostic() {
		return this.diagnostic;
	}
	/**
	* The structured failure fact observed for this published turn.
	* Call only after a non-completed return or rejection from {@link runTurn}.
	* @returns the fixed stage/category pair and optional HTTP status.
	*/
	collectFailure() {
		return this.failure;
	}
	/** Detach JSON-RPC listeners and reject outstanding requests. Idempotent. */
	close() {
		if (this.closed) return;
		this.closed = true;
		this.input.off("end", this.onInputEnd);
		this.transport.close();
	}
	async guarded(pending, signal) {
		return raceAbort(Promise.race([this.fatal.promise, pending]), signal);
	}
	fail(error) {
		this.fatal.reject(error);
	}
	onInputError = (error) => {
		this.fail(error);
	};
	onOutputError = (error) => {
		this.fail(error);
	};
	onInputEnd = () => {
		this.inputEnded = true;
		this.fail(/* @__PURE__ */ new Error("subagent-codex: app-server protocol stream closed"));
	};
	observePendingTurnId(id) {
		if (this.turnCompleted === void 0) throw new Error("subagent-codex: app-server referenced a turn before turn/start");
		if (this.pendingTurnId !== void 0 && this.pendingTurnId !== id) throw new Error("subagent-codex: app-server referenced conflicting turns");
		this.pendingTurnId = id;
	}
	commitTurnId(id) {
		if (this.pendingTurnId !== void 0 && this.pendingTurnId !== id) throw new Error("subagent-codex: turn/start response did not match the active turn");
		this.turnId = id;
		const pendingDiagnostic = this.pendingDiagnostic;
		this.pendingDiagnostic = void 0;
		if (pendingDiagnostic !== void 0) this.recordDiagnostic(pendingDiagnostic.request, pendingDiagnostic.decision, pendingDiagnostic.reason, pendingDiagnostic.order);
		const notifications = this.earlyTurnNotifications.splice(0);
		for (const notification of notifications) this.handleNotification(notification.method, notification.params, notification.order);
	}
	/**
	* Validate the request's thread and turn association.
	* @returns `true` when the matching turn is still provisional, so the caller
	* defers its diagnostic until `commitTurnId()`.
	*/
	validateRunIds(params, nullableTurn = false) {
		if (params.threadId !== this.threadId) throw new Error("subagent-codex: app-server request referenced another thread");
		if (nullableTurn && params.turnId === null) return false;
		const id = string(params.turnId, "server request turn id");
		if (this.turnId === void 0) {
			this.observePendingTurnId(id);
			return true;
		}
		if (id !== this.turnId) throw new Error("subagent-codex: app-server request referenced another turn");
		return false;
	}
	recordRequestDiagnostic(provisional, request, decision, reason) {
		const order = this.nextObservationOrder();
		if (provisional) {
			this.pendingDiagnostic = {
				order,
				request,
				decision,
				reason
			};
			return;
		}
		this.recordDiagnostic(request, decision, reason, order);
	}
	recordDiagnostic(request, decision, reason, order = this.nextObservationOrder()) {
		if (order < this.diagnosticOrder) return;
		this.diagnosticOrder = order;
		this.diagnostic = unattendedDiagnostic(this.permissionMode, request, decision, reason);
	}
	recordFailure(facts) {
		this.failure = facts;
	}
	nextObservationOrder() {
		this.observationOrder += 1;
		return this.observationOrder;
	}
	recordDeclinedItem(item, order) {
		if (item.type === "commandExecution" && item.status === "declined") {
			this.recordDiagnostic("command execution", "declined", "Codex declined the command under the selected permission mode", order);
			return true;
		}
		if (item.type === "fileChange" && item.status === "declined") {
			this.recordDiagnostic("file change", "declined", "Codex declined the file change under the selected permission mode", order);
			return true;
		}
		return false;
	}
	/**
	* Decide one approval request through the configured permission policy.
	* Without an asker (older hosts, test harnesses) every request stays
	* unattended and denied, matching the historical behavior. A throwing
	* asker also denies: the request must always be answerable.
	* @param request - policy-facing summary of the ask.
	* @returns the policy decision.
	*/
	async decidePermission(request) {
		const ask = this.approval?.ask;
		if (ask === void 0) return { outcome: "deny", scope: "once", source: "unattended" };
		try {
			return await ask(request);
		} catch {
			return { outcome: "deny", scope: "once", source: "asker-error" };
		}
	}
	handleServerRequest(method, params) {
		try {
			switch (method) {
				case "item/commandExecution/requestApproval": {
					const provisional = this.validateRunIds(params);
					return this.resolveItemApproval(provisional, params, "command approval", {
						kindLabel: "command execution",
						title: commandApprovalTitle(params),
						detail: commandApprovalTitle(params),
					});
				}
				case "item/fileChange/requestApproval": {
					const provisional = this.validateRunIds(params);
					return this.resolveItemApproval(provisional, params, "file approval", {
						kindLabel: "file change",
						title: fileChangeApprovalTitle(params),
						detail: fileChangeApprovalTitle(params),
					});
				}
				case "item/permissions/requestApproval":
					return this.resolvePermissionsApproval(this.validateRunIds(params), params);
				case "item/tool/requestUserInput":
					this.recordRequestDiagnostic(this.validateRunIds(params), "user input", "empty response", "the provider does not collect interactive answers");
					return Promise.resolve({ answers: {} });
				case "mcpServer/elicitation/request":
					this.recordRequestDiagnostic(this.validateRunIds(params, true), "MCP elicitation", "declined", "the provider does not collect interactive MCP input");
					return Promise.resolve({
						action: "decline",
						content: null,
						_meta: null
					});
				default: throw new Error(`subagent-codex: unsupported app-server request ${JSON.stringify(method)}`);
			}
		} catch (error) {
			const normalized = thrown$1(error);
			this.fail(normalized);
			return Promise.reject(normalized);
		}
	}
	/**
	* Route one command/file approval through the permission policy and build
	* the wire response.
	*/
	async resolveItemApproval(provisional, params, label, request) {
		const decision = await this.decidePermission(request);
		if (decision.outcome === "allow" && offersPlainAccept(params)) {
			this.recordRequestDiagnostic(provisional, label, "accepted", `granted by ${decision.source}`);
			return { decision: "accept" };
		}
		const wireDecision = deniedDecision(params);
		this.recordRequestDiagnostic(provisional, label, wireDecision === "cancel" ? "cancelled" : "declined", `denied by ${decision.source}`);
		return { decision: wireDecision };
	}
	/**
	* Route one `item/permissions/requestApproval` through the permission
	* policy. A grant echoes the requested permissions for the current turn;
	* a denial grants nothing. The request's grants field follows the wire
	* response vocabulary (`permissions`); an unrecognized shape grants
	* nothing rather than guessing.
	*/
	async resolvePermissionsApproval(provisional, params) {
		const decision = await this.decidePermission({
			kindLabel: "permission grant",
			title: permissionsApprovalTitle(params),
			detail: permissionsApprovalDetail(params),
		});
		if (decision.outcome === "allow") {
			const requested = params.permissions ?? params.additionalPermissions
			if (requested !== null && typeof requested === "object") {
				this.recordRequestDiagnostic(provisional, "permission grant", "granted", `granted by ${decision.source}`);
				return {
					permissions: requested,
					scope: "turn"
				};
			}
			this.recordRequestDiagnostic(provisional, "permission grant", "denied", `granted by ${decision.source} but the request carried no recognizable permissions object`);
			return {
				permissions: {},
				scope: "turn"
			};
		}
		this.recordRequestDiagnostic(provisional, "permission grant", "denied", `denied by ${decision.source}`);
		return {
			permissions: {},
			scope: "turn"
		};
	}
	handleNotification(method, params, order) {
		if (method === "turn/started") {
			if (string(params.threadId, "turn/started thread id") !== this.threadId) return;
			const turn = object(params.turn, "turn/started turn");
			// A resumed thread may emit old turn notifications. Only the new
			// turn/start response is authoritative for notification identity.
			return;
		}
		if (method === "item/completed") {
			if (string(params.threadId, "item/completed thread id") !== this.threadId) return;
			const id = string(params.turnId, "item/completed turn id");
			if (this.turnId === void 0) {
				if (this.turnCompleted !== void 0) {
					this.earlyTurnNotifications.push({
						method,
						params,
						order: this.nextObservationOrder()
					});
				}
				return;
			}
			if (id !== this.turnId) return;
			const item = object(params.item, "item/completed item");
			if (this.recordDeclinedItem(item, order)) return;
			if (item.type !== "agentMessage") return;
			const text = typeof item.text === "string" ? item.text : (() => {
				throw new Error("subagent-codex: app-server returned an invalid agent message");
			})();
			if (item.phase === "final_answer") this.lastFinalAnswer = text;
			else if (item.phase === "partial_answer") this.lastPartialAnswer = text;
			else if (item.phase === null) this.lastUnphasedAnswer = text;
			else if (item.phase !== "commentary") throw new Error(`subagent-codex: app-server returned an unknown agent message phase ${JSON.stringify(item.phase)}`);
			return;
		}
		if (method !== "turn/completed") return;
		if (string(params.threadId, "turn/completed thread id") !== this.threadId) return;
		const turn = object(params.turn, "turn/completed turn");
		const id = string(turn.id, "turn/completed turn id");
		const turnCompleted = this.turnCompleted;
		if (turnCompleted === void 0) return;
		if (this.turnId === void 0) {
			this.earlyTurnNotifications.push({
				method,
				params,
				order: this.nextObservationOrder()
			});
			return;
		}
		if (id !== this.turnId) return;
		this.terminalObserved = true;
		if (![
			"completed",
			"interrupted",
			"failed"
		].includes(String(turn.status))) throw new Error(`subagent-codex: app-server returned invalid terminal turn status ${String(turn.status)}`);
		turnCompleted.resolve({
			params,
			order: order ?? this.nextObservationOrder()
		});
	}
};
//#endregion
//#region lib/types/run.js
/**
* One-shot Codex child lifecycle: spawn the real app-server through the
* subprocess seam, publish only after initialization and ephemeral thread
* creation, flatten post-publication failures, and dispose to whole-range
* quiescence.
*
* @module @deepseek-ai/dsh-subagent-codex/run
*/
/** Default POSIX grace between subprocess termination tiers. */
const DEFAULT_DISPOSE_GRACE_MS = 3e3;
/** Native non-interactive Codex modes mapped to official `thread/start` fields. */
const CODEX_PERMISSION_MODES = [
	"never",
	"approve-for-me",
	"dangerously-bypass-approvals-and-sandbox"
];
/** Safe default for unattended Codex runs. */
const DEFAULT_CODEX_PERMISSION_MODE = "never";
function failureDiagnostic(facts) {
	const fields = [
		"product: Codex",
		`stage: ${facts.stage}`,
		`category: ${facts.category}`
	];
	if (facts.httpStatus !== void 0) fields.push(`HTTP status: ${facts.httpStatus}`);
	const processFields = [["exit code", facts.outcome?.exitCode], ["signal", facts.outcome?.signal]];
	for (const [label, value] of processFields) if (value !== null && value !== void 0) fields.push(`${label}: ${value}`);
	return `Product subagent failure (${fields.join("; ")})`;
}
var CodexRunFailure = class extends Error {
	facts;
	constructor(facts, cause) {
		super(`subagent-codex: ${failureDiagnostic(facts)}`, cause === void 0 ? void 0 : { cause });
		this.facts = facts;
		this.name = "CodexRunFailure";
	}
};
/**
* Hide an unpublished Host failure behind fixed safe startup facts.
* @param cause Original Host failure retained for internal diagnostics.
* @returns A startup failure whose message contains only fixed safe facts.
*/
function codexStartupFailure(cause) {
	return new CodexRunFailure({
		stage: "initialize",
		category: "unknown"
	}, cause);
}
/**
* Use an explicit CLI when configured, otherwise the package-local wrapper.
* @returns The executable and fixed app-server arguments.
*/
function codexAppServerArgv(command) {
	if (command !== void 0) {
		if (typeof command !== "string" || command.trim().length === 0) throw new Error("subagent-codex: command must be a non-empty string");
		assertDirectCommand(command.trim());
		return [command.trim(), "app-server", "--stdio"];
	}
	return codexWrapperArgv(["app-server", "--stdio"]);
}

export function codexAppServerEnv(command, env, electron = process.versions.electron !== void 0) {
	return command === void 0 && electron ? { ...env, ELECTRON_RUN_AS_NODE: "1" } : env;
}
function thrown(value) {
	/* v8 ignore next -- typed subprocess/wire failures reject with Error. */
	return value instanceof Error ? value : new Error(String(value));
}
/**
* Validate and preserve the one-shot task before crossing the process boundary.
* @param prompt - task content accepted from the shared subagent service.
* @returns the exact non-empty text block sequence.
*/
function textTask(prompt) {
	if (prompt.length === 0) throw new Error("subagent-codex: the one-shot task must contain only text blocks");
	const texts = [];
	for (const block of prompt) {
		if (block.type !== "text") throw new Error("subagent-codex: the one-shot task must contain only text blocks");
		texts.push(block.text);
	}
	if (texts.every((text) => text.trim().length === 0)) throw new Error("subagent-codex: the one-shot task must not be empty");
	return texts;
}
/**
* Close the private wire, terminate the managed range, and wait for the
* subprocess owner to prove it is quiescent.
* @param wire - private app-server protocol connection.
* @param child - shared-service handle that owns the managed range.
*/
async function disposeCodexChild(wire, child) {
	wire.close();
	let outcome;
	child.done.then((value) => {
		outcome = value;
	}, () => {});
	try {
		child.stdin?.end();
	} catch {}
	child.terminate();
	try {
		await child.waitForExit();
	} catch (error) {
		throw new CodexRunFailure({
			stage: "teardown",
			category: "unknown",
			outcome
		}, thrown(error));
	}
	await child.done.catch(() => {});
}
/**
* Start the real `codex app-server --stdio` child and publish its one-shot run.
* @param request - resolved shared subagent request.
* @param spec - Workspace, environment, process service, and diagnostic policy.
* @returns the published run after initialization and ephemeral thread creation.
*/
async function startCodexRun(request, spec) {
	const trace = currentTaskTrace();
	const resume = trace?.resume?.agent === "codex" ? trace.resume : void 0;
	if (resume && (!spec.tasks || resume.sessionId === void 0)) throw new Error("subagent-codex: Codex resume requires the task monitor");
	const texts = textTask(request.prompt);
	if (request.signal.aborted) throw new Error("subagent-codex: request was aborted before app-server startup");
	let child;
	try {
		child = spec.spawn({
			argv: codexAppServerArgv(spec.command),
			cwd: spec.cwd,
			stdio: {
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe"
			},
			graceMs: spec.disposeGraceMs,
			env: codexAppServerEnv(spec.command, spec.env)
		});
	} catch (error) {
		throw new CodexRunFailure({
			stage: "initialize",
			category: "unknown"
		}, thrown(error));
	}
	const wire = new CodexAppServerWire(child.stdout, child.stdin, effectiveCodexThreadMode(
		spec.permissionMode,
		normalizePermissionPolicy(spec.permissionPolicy),
		normalizeSubagentPermissionMode(spec.subagentPermissionMode),
		spec.mainSessionFullAccess === true,
	), spec.model, { ask: spec.askPermission });
	const onStderr = (chunk) => {
		const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
		try {
			writeFileSync(process.stderr.fd, bytes);
		} catch {}
	};
	const onStderrError = () => {};
	child.stderr?.on("data", onStderr);
	child.stderr?.on("error", onStderrError);
	const disposeProcess = async () => {
		try {
			await disposeCodexChild(wire, child);
			await new Promise((resolve) => {
				setImmediate(resolve);
			});
		} finally {
			child.stderr?.off("data", onStderr);
			child.stderr?.off("error", onStderrError);
		}
	};
	let processFailureFacts;
	const processFailure = child.done.then((outcome) => {
		processFailureFacts = {
			stage: "process",
			category: "process",
			outcome
		};
		throw new CodexRunFailure(processFailureFacts);
	}, (error) => {
		processFailureFacts = {
			stage: "process",
			category: "unknown"
		};
		throw new CodexRunFailure(processFailureFacts, thrown(error));
	});
	processFailure.catch(() => {});
	const runAbort = new AbortController();
	const requestCancel = () => {
		if (runAbort.signal.aborted) return;
		runAbort.abort(/* @__PURE__ */ new Error("subagent-codex: run cancelled locally"));
		wire.interrupt();
	};
	const onAbort = () => {
		requestCancel();
	};
	request.signal.addEventListener("abort", onAbort, { once: true });
	let startupStage = "initialize";
	try {
		wire.start();
		await Promise.race([wire.initialize(request.signal), processFailure]);
		startupStage = resume ? "thread-resume" : "thread-start";
		const threadId = await Promise.race([
			resume
				? wire.resumeThread(resume.sessionId, spec.cwd, request.signal)
				: wire.startThread(spec.cwd, request.signal),
			processFailure
		]);
		spec.tasks?.setExternalSession("codex", threadId);
	} catch (error) {
		request.signal.removeEventListener("abort", onAbort);
		const cancelledBeforeCleanup = runAbort.signal.aborted;
		if (!(error instanceof CodexRunFailure) && !cancelledBeforeCleanup) await new Promise((resolve) => {
			setImmediate(resolve);
		});
		const failure = new CodexRunFailure({
			stage: startupStage,
			category: "unknown",
			outcome: error instanceof CodexRunFailure ? error.facts.outcome : processFailureFacts?.outcome
		}, thrown(error));
		try {
			await disposeProcess();
		} catch (disposeError) {
			const cleanupFailure = thrown(disposeError);
			throw new AggregateError([failure, cleanupFailure], `${failure.message}; ${cleanupFailure.message}`);
		}
		if (cancelledBeforeCleanup) throw new Error("subagent-codex: request was aborted before run publication");
		try {
			request.signal.throwIfAborted();
		} catch {
			throw new Error("subagent-codex: request was aborted before run publication");
		}
		throw failure;
	}
	const collectOutput = () => wire.collectOutput();
	let diagnostic;
	const recordFailureDiagnostic = (facts) => {
		const failure = failureDiagnostic(facts);
		const permission = wire.collectDiagnostic();
		diagnostic = permission === void 0 ? failure : `${failure}\n${permission}`;
		return diagnostic;
	};
	const withProcessOutcome = (facts) => {
		const outcome = processFailureFacts?.outcome;
		return outcome === void 0 ? facts : {
			...facts,
			outcome
		};
	};
	const publishedProcessFailure = processFailure.catch(async (error) => {
		await new Promise((resolve) => {
			setImmediate(resolve);
		});
		throw error;
	});
	const result = settleRunResult({
		attempt: async () => {
			try {
				const terminal = await Promise.race([
					wire.runTurn(texts, runAbort.signal, resume ? void 0 : spec.reasoningEffort),
					publishedProcessFailure
				]);
				if (terminal.stopReason === "completed") return terminal;
				await new Promise((resolve) => {
					setImmediate(resolve);
				});
				const facts = withProcessOutcome(wire.collectFailure());
				return {
					...terminal,
					diagnostic: recordFailureDiagnostic(facts)
				};
			} catch (error) {
				await new Promise((resolve) => {
					setImmediate(resolve);
				});
				const endedBeforeTerminal = wire.endedBeforeTerminal();
				if (endedBeforeTerminal && processFailureFacts === void 0 && !runAbort.signal.aborted) try {
					if (await child.waitForExit(AbortSignal.timeout(Math.ceil(spec.disposeGraceMs)))) await child.done;
				} catch {}
				const facts = error instanceof CodexRunFailure ? error.facts : endedBeforeTerminal && processFailureFacts !== void 0 ? processFailureFacts : withProcessOutcome(wire.collectFailure());
				recordFailureDiagnostic(facts);
				throw error instanceof CodexRunFailure ? error : new CodexRunFailure(facts, thrown(error));
			}
		},
		collectOutput,
		collectDiagnostic: () => diagnostic,
		cancelled: () => runAbort.signal.aborted,
		onError: spec.onError,
		signal: request.signal,
		onAbort
	});
	return subprocessRunHandle({
		id: randomUUID(),
		result,
		signal: request.signal,
		onAbort,
		requestCancel,
		teardown: disposeProcess
	});
}
//#endregion
//#region lib/types/index.js
/**
* Profile-named Codex one-shot subagent provider. Every accepted run starts the
* configured CLI or official package-local wrapper with `app-server --stdio` in
* the delegating Session's workspace and publishes after creating or resuming a persistent thread.
*
* @module @deepseek-ai/dsh-subagent-codex
*/
const name = "subagent-codex";
const inject = ["subagents", "subprocess"];
const DEFAULT_PROVIDER_NAME = "codex";
export class CodexProvider {
	name;
	ctx;
	config;
	capabilities = NO_START_CAPABILITIES;
	inheritsParentContext = false;
	constructor(name, ctx, config) {
		this.name = name;
		this.ctx = ctx;
		this.config = config;
	}
	start(request) {
		const trace = currentTaskTrace();
		const resume = trace?.resume?.agent === "codex" ? trace.resume : void 0;
		const resumeCwd = resume && trace.record?.cwd;
		if (resume && (typeof resume.sessionId !== "string" || resume.sessionId.length === 0)) throw new Error("subagent-codex: saved Codex session has no thread id");
		if (resume && (typeof resumeCwd !== "string" || typeof request.cwd !== "string")) throw new Error("subagent-codex: Codex resume must use the saved cwd");
		if (resume && !sameDirectory(request.cwd, resumeCwd)) throw new Error("subagent-codex: Codex resume must use the saved cwd");
		let cwd;
		try {
			cwd = assertUsableCwd("subagent-codex", "child cwd", request.cwd);
	} catch (error) {
		if (resume && error.message === "subagent-codex: Codex resume must use the saved cwd") throw error;
			if (request.signal.aborted) throw new Error("subagent-codex: request was aborted before app-server startup");
			throw codexStartupFailure(error);
		}
		const permissionPolicy = normalizePermissionPolicy(this.config.permissionPolicy);
		const subagentPermissionMode = normalizeSubagentPermissionMode(this.config.subagentPermissionMode);
		const mainSessionFullAccess = permissionPolicy === "main-session"
			&& resolveMainSessionFullAccess(this.ctx, request.parent);
		const askPermission = createPermissionAsker({
			ctx: this.ctx,
			parent: request.parent,
			policy: permissionPolicy,
			subagentMode: subagentPermissionMode,
			backend: "codex",
			agentLabel: "Codex",
			language: trace?.record?.language,
			signal: request.signal,
			mainSessionFullAccess,
		});
		return startCodexRun(request, {
			cwd,
			command: this.config.command,
			...resume || this.config.model === void 0 ? {} : { model: this.config.model },
			...resume || this.config.reasoningEffort === void 0 ? {} : { reasoningEffort: this.config.reasoningEffort },
			permissionMode: this.config.permissionMode,
			permissionPolicy,
			subagentPermissionMode,
			mainSessionFullAccess,
			askPermission,
			env: this.config.env,
			disposeGraceMs: this.config.disposeGraceMs,
			tasks: this.ctx.get("multiAgentTasks"),
			spawn: (spawnSpec) => this.ctx.subprocess.spawn(spawnSpec),
			onError: (error, stopReason) => {
				this.ctx.logger.warn(`subagent-codex "${this.name}": child run failed (${stopReason}): ${error.message}`);
			}
		});
	}
};
/**
* Register one Profile-named Codex provider.
* @param ctx - context carrying shared subagent and subprocess services.
* @param config - registry name, optional command and model, permission mode, child environment, and disposal grace.
*/
export function applyCodexProvider(ctx, config) {
	const resolved = {
		providerName: config.providerName ?? DEFAULT_PROVIDER_NAME,
		...config.command === void 0 ? {} : { command: config.command },
		...config.model === void 0 ? {} : { model: config.model },
		...config.reasoningEffort === void 0 ? {} : { reasoningEffort: config.reasoningEffort },
		env: config.env,
		permissionMode: config.permissionMode ?? "never",
		permissionPolicy: normalizePermissionPolicy(config.permissionPolicy),
		subagentPermissionMode: normalizeSubagentPermissionMode(config.subagentPermissionMode),
		disposeGraceMs: config.disposeGraceMs
	};
	assertPositiveFinite("subagent-codex", "disposeGraceMs", resolved.disposeGraceMs);
	if (resolved.disposeGraceMs > MAX_TIMER_DELAY_MS) throw new Error(`subagent-codex: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`);
	return ctx.subagents.registerProvider(new CodexProvider(resolved.providerName, ctx, resolved));
}
//#endregion
