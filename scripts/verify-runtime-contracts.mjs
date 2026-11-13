#!/usr/bin/env node
/**
 * 双版本官方源码的隔离契约验证；无联网、安装、模型请求或 bundle 写入。
 * 用法见 --help。真实方法由固定 SHA-256 源码提取，禁止静默换成 mock。
 * 此脚本没有启动 Cordis 容器；resource/session/lifecycle 边界使用明确的 stub。
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SUBAGENT = 'packages/subagent/subagent/src/';
const AGENT = 'packages/core/agent/src/index.ts';
// 指纹来自官方固定 tag 的源码；仅锁定执行涉及的文件，不声称验证整个 checkout。
const RELEASES = {
  "rc1": {
    "commit": "66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db",
    "files": {
      "packages/core/agent/src/index.ts": "19c6c34dd4dd63dfa8c3c388bffe0cd4d4f254a1fc564eb52c44ef4321f79b39",
      "packages/subagent/subagent/src/index.ts": "a64059b63fb2ec6867ab22aba6a54dfad0ade6a1ed0e3c7c4af01cc0fe88b50d",
      "packages/subagent/subagent/src/manager.ts": "1e1844c145d6f985d594d348ed5f89a6d8e3283bab519ef88263f3d2d2a9fe07",
      "packages/subagent/subagent/src/depth.ts": "52fe8c33e3becc3c5925ce4c63cfa097dc67158207e50db4622c7b9c15bc9b6f",
      "packages/subagent/subagent/src/error.ts": "efdb67c6c6342c53775d817eebeb495c959892f95b2e00a1eda5a71d711fa4ce",
      "packages/subagent/subagent/src/activation.ts": "5f5222ab69ac3def6d4b4d7bcc7a0658d1a45f32f306d63f3a5a668977f8bac1"
    }
  },
  "rc2": {
    "commit": "ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c",
    "files": {
      "packages/core/agent/src/index.ts": "c3af768658850fddda9ec91afb12f55a52b6101c43356b428919679a525e2bba",
      "packages/subagent/subagent/src/index.ts": "b9b098db20176ea066895bda65aa20aadfb8d32f25a5a2eb033122885a74bf36",
      "packages/subagent/subagent/src/manager.ts": "8488f36b734c946fdc577c6542205ab7c68f82df413e607427108060393532a5",
      "packages/subagent/subagent/src/depth.ts": "52fe8c33e3becc3c5925ce4c63cfa097dc67158207e50db4622c7b9c15bc9b6f",
      "packages/subagent/subagent/src/error.ts": "efdb67c6c6342c53775d817eebeb495c959892f95b2e00a1eda5a71d711fa4ce",
      "packages/subagent/subagent/src/activation.ts": "eb4363430b67029c7775fea3fad1d4a3380fcdbe3a0c5c16348395c21f54ae65",
      "packages/subagent/subagent/src/names.ts": "5573918f19e7b210303f75daa733bc4d47581b9034f86eaa02960aa390b61ca4"
    }
  }
};

function normalizeLineEndings(source) {
  return source.replaceAll('\r\n', '\n');
}

function evaluate(source, bindings = {}) {
  const js = stripTypeScriptTypes(`function evaluateOfficialSource() {\n${source}\n}`, { mode: 'strip' });
  return new Function(...Object.keys(bindings), `${js}\nreturn evaluateOfficialSource()`)(...Object.values(bindings));
}

// 固定文件指纹保证上游缩进/结构已知；无法找到唯一实现时硬失败。
function method(source, name) {
  source = normalizeLineEndings(source);
  const pattern = new RegExp(`^  (?:private |protected |public )?(?:async )?${name}(?:<[^\\n]+?>)?\\(`, 'gm');
  const candidates = [...source.matchAll(pattern)].filter(match => {
    const line = source.slice(match.index, source.indexOf('\n', match.index));
    // startActivation 的 overload 无方法体，排除后只剩真实实现。
    return !['startActivation', 'startExternal'].includes(name) || line.includes(`async ${name}`);
  });
  assert.equal(candidates.length, 1, `无法唯一定位上游方法 ${name}`);
  const start = candidates[0].index;
  const end = source.indexOf('\n  }', start);
  assert.ok(end > start, `上游方法 ${name} 缺少结束边界`);
  return source.slice(start, end + 4);
}

function declaration(source, marker) {
  source = normalizeLineEndings(source);
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `缺少上游声明 ${marker}`);
  const end = source.indexOf('\n}', start);
  assert.ok(end > start, `声明 ${marker} 缺少结束边界`);
  return source.slice(start, end + 2).replace(/^export /, '');
}

function methods(source, names, bindings) {
  return evaluate(`return class {\n${names.map(name => method(source, name)).join('\n')}\n}`, bindings).prototype;
}

export async function loadOfficialSource(version, directory) {
  const release = RELEASES[version];
  assert.ok(release, `未知版本 ${version}`);
  const sources = {};
  for (const [relative, expected] of Object.entries(release.files)) {
    const raw = await readFile(resolve(directory, relative), 'utf8');
    // Git CRLF 检出仅转换换行符；还原 LF 后仍以固定官方 SHA-256 严格验真。
    const source = normalizeLineEndings(raw);
    const actual = createHash('sha256').update(source).digest('hex');
    assert.equal(actual, expected, `${version} 源码指纹不符：${relative}（要求 ${release.commit}）`);
    sources[relative] = source;
  }
  return { version, commit: release.commit, directory: resolve(directory), sources };
}

export function createIsolatedRuntime(upstream) {
  const modern = upstream.version === 'rc2';
  const source = name => normalizeLineEndings(upstream.sources[SUBAGENT + name + '.ts']);
  const observations = { requests: [], materializations: [], catalogs: [], disposed: [], releases: 0, starts: 0 };
  // 错误基类仅提供 message/code；SubagentError 子类本身来自官方源码。
  class HarnessError extends Error {
    constructor(message, code, options) { super(message, options); this.code = code; }
  }
  const SubagentError = evaluate(`${declaration(source('error'), 'export class SubagentError')}\nreturn SubagentError`, { HarnessError });
  const assertSubagentMaxDepth = evaluate(`${declaration(source('depth'), 'export function assertSubagentMaxDepth')}\nreturn assertSubagentMaxDepth`);
  const activationAgent = evaluate(`${declaration(source('activation'), 'export function activationAgent')}\nreturn activationAgent`);
  // 不运行 Service 构造、注册或 init；使用完整真实 AgentRegistry 原型。
  class Service { static init = Symbol('init'); }
  const AgentRegistry = evaluate(`${declaration(upstream.sources[AGENT], 'export class AgentRegistry')}\nreturn AgentRegistry`, { Service });
  const agents = Object.create(AgentRegistry.prototype);
  agents.store = new Map();
  const parent = { id: 'root', session: { id: 'root', header: {}, isOwnSeq: () => false } };
  agents.store.set(parent.id, { agent: parent });
  const ctx = {
    agents,
    get(name) { return this[name]; },
    logger: { warn(message) { throw new Error(`意外的回滚警告：${message}`); } },
    workingDirectory: { async ensure() { return resolve('contract-fixture'); } },
  };
  const provider = {
    name: 'contract-external',
    capabilities: { agentPreset: true, agentOptions: true, outputSchema: true, depthLimit: true },
    async start(request) {
      observations.starts++;
      observations.requests.push(request);
      if (observations.providerError) throw observations.providerError;
      return {
        id: 'external-child',
        result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'fixture' }] }),
        async dispose() {},
      };
    },
  };
  const bindings = {
    SubagentError, assertSubagentMaxDepth, activationAgent, randomUUID, isAbsolute, resolve,
    brandString: value => value,
    // 只观察 catalog 写入参数，不运行真实 Session append/projection。
    establishExternalCatalogChild: (...args) => observations.catalogs.push(args),
    failureMessage: error => error.message,
    // schema checker 在成功样本中仅检查 object；不宣称验证完整 JSON Schema。
    assertObjectJsonSchema(schema) { assert.equal(schema.type, 'object'); },
  };
  if (modern) {
    for (const name of ['joinAgentPath', 'agentAddress']) {
      bindings[name] = evaluate(`${declaration(source('names'), `export function ${name}`)}\nreturn ${name}`, { ROOT_AGENT_NAME: 'lead' });
    }
  }
  const managerNames = ['startExternal', 'resolveDirectory', 'assertAdmitting', 'receipt'];
  if (modern) managerNames.push('startExternalNamed', 'rootOf', 'ancestryForChild', 'pathOf', 'trackStartup');
  else managerNames.push('assertLiveParent');
  const manager = Object.create(methods(source('manager'), managerNames, bindings));
  Object.assign(manager, {
    ctx,
    resident: new Map(),
    materializations: new Set(),
    host: { identityOf: session => session.identity },
    closingTeardownFor: () => undefined,
    holdOwnership: () => () => { observations.releases++; },
    reserveName: (_parent, requested) => ({ name: requested ?? 'agent-1', release() { observations.releases++; } }),
    // 此处是明确的物化替身：调用真实方法构造的 start 回调，不模拟请求转换。
    async materialize(inputs) {
      observations.materializations.push(inputs);
      inputs.signal.throwIfAborted();
      const run = await inputs.start(inputs.signal);
      return { ...inputs, childId: run.id, result: { promise: run.result } };
    },
    announce() {}, accept() {},
    async dispose(activation) { observations.disposed.push(activation.childId); },
    async startLocal() { throw new Error('隔离验证不覆盖本地 Agent 物化'); },
  });
  const serviceNames = ['startActivation', 'expectProvider', 'requireManager', 'assertCapabilities'];
  if (modern) serviceNames.push('assertProviderCurrent', 'rootOf', 'namesOf', 'resolveName');
  const subagents = Object.create(methods(source('index'), serviceNames, bindings));
  Object.assign(subagents, { ctx, manager, providers: new Map([[provider.name, provider]]) });
  if (!modern) {
    // 原封提取 rc.1 构造器中 manager 的 provider 桥接回调。
    const match = source('index').match(/startExternal: (\(name, request\) => \{[\s\S]*?\n        \}),/);
    assert.ok(match, 'rc.1 provider 桥接回调未找到');
    manager.host.startExternal = evaluate(`return function () { return ${match[1]} }`, {}).call(subagents);
  }
  ctx.subagents = subagents;
  const controller = new AbortController();
  const flatSpec = {
    provider: provider.name, parent, prompt: [{ type: 'text', text: '无模型调用的契约验证' }], cwd: 'child',
    label: '契约验证', signal: controller.signal, delivery: 'caller', maxDepth: 2,
    agentPreset: 'fixture-preset',
    agentOptions: { provider: 'fixture-route', model: 'fixture-model', reasoningEffort: undefined },
    outputSchema: { type: 'object', properties: {} },
  };
  return { ctx, parent, provider, agents, subagents, manager, observations, flatSpec, controller, modern, AgentRegistry };
}

function nativeSpec(harness, flatSpec = harness.flatSpec) {
  if (harness.modern) return flatSpec;
  const { provider, label, signal, delivery, childId, ...request } = flatSpec;
  return { provider, label, signal, delivery, ...(childId === undefined ? {} : { childId }), request };
}

async function rejectionWithoutStart(h, call, message) {
  await assert.rejects(async () => call(), message);
  assert.equal(h.observations.starts, 0, '拒绝必须发生在 provider.start 之前');
  assert.equal(h.observations.materializations.length, 0, '拒绝不得进入物化阶段');
}

export async function verifyRuntimeContracts({ rc1Source, rc2Source, compatibility, upstreamOnly = false, onCheck = () => {} }) {
  const upstreams = await Promise.all([loadOfficialSource('rc1', rc1Source), loadOfficialSource('rc2', rc2Source)]);
  const checks = [];
  async function check(name, operation) {
    let timeout;
    try {
      await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error(`契约检查超时：${name}`)), 5_000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    checks.push(name);
    onCheck(name);
  }
  for (const upstream of upstreams) {
    const make = () => createIsolatedRuntime(upstream);
    await check(`${upstream.version}：真实类能力与 native startActivation → manager → fake provider`, async () => {
      const h = make();
      assert.equal(typeof h.agents.roots, h.modern ? 'undefined' : 'function');
      assert.equal(typeof h.subagents.rootOf, h.modern ? 'function' : 'undefined');
      assert.strictEqual(h.agents.get(h.parent.id), h.parent);
      assert.deepEqual(h.agents.list(), [h.parent]);
      const activation = await h.subagents.startActivation(nativeSpec(h));
      assert.equal(activation.childId, 'external-child');
      assert.equal(h.observations.starts, 1);
      assert.strictEqual(h.observations.requests[0].agentOptions, h.flatSpec.agentOptions);
      assert.equal(h.observations.requests[0].cwd, resolve('contract-fixture', 'child'));
    });
    await check(`${upstream.version}：错误输入形状被真实方法拒绝，零 provider 调用`, async () => {
      const h = make();
      const wrong = h.modern ? { ...h.flatSpec, parent: undefined, request: h.flatSpec } : h.flatSpec;
      await rejectionWithoutStart(h, () => h.subagents.startActivation(wrong));
    });
    if (upstreamOnly) continue;
    assert.ok(compatibility, '需要兼容层模块，或显式选择 --upstream-only');
    const { isRootAgent, findRootAgent, isModernSubagentRuntime, startManagedActivation } = compatibility;
    for (const [name, value] of Object.entries({ isRootAgent, findRootAgent, isModernSubagentRuntime, startManagedActivation })) {
      assert.equal(typeof value, 'function', `兼容层缺少导出 ${name}`);
    }
    await check(`${upstream.version}：root、普通 fork、child、同 id 冒名、失效实例`, () => {
      const h = make();
      assert.equal(isModernSubagentRuntime(h.ctx), h.modern);
      assert.equal(isRootAgent(h.ctx, h.parent), true);
      assert.strictEqual(findRootAgent(h.ctx, h.parent.id), h.parent);
      assert.equal(isRootAgent(h.ctx, { ...h.parent }), false);
      assert.ok(!findRootAgent(h.ctx, 'absent'));
      const fork = { id: 'fork', session: { id: 'fork', header: { parentSession: h.parent.id, origin: 'fork' }, isOwnSeq: () => false } };
      h.agents.store.set(fork.id, { agent: fork });
      assert.equal(isRootAgent(h.ctx, fork), true);
      // 用非 subagent header 逼迫兼容层调用真实运行时归属，而非只依赖持久头。
      const child = { id: 'child', session: { id: 'child', header: { origin: 'user' }, isOwnSeq: () => false } };
      h.agents.store.set(child.id, { agent: child, owner: h.parent });
      h.manager.resident.set(child.id, { kind: 'local', handle: { agent: child }, root: h.parent });
      assert.equal(isRootAgent(h.ctx, child), false);
      assert.ok(!findRootAgent(h.ctx, child.id));
      h.manager.resident.delete(child.id);
      child.session.identity = { seq: 1 };
      child.session.isOwnSeq = () => true;
      if (h.modern) assert.throws(() => h.subagents.rootOf(child), error => error.code === 'UNAUTHORIZED');
      assert.equal(isRootAgent(h.ctx, child), false);
      const restored = { id: 'restored', session: { id: 'restored', header: { origin: 'subagent' }, isOwnSeq: () => false } };
      h.agents.store.set(restored.id, { agent: restored });
      assert.equal(isRootAgent(h.ctx, restored), false);
      h.agents.store.delete(h.parent.id);
      assert.equal(isRootAgent(h.ctx, h.parent), false);
    });
    for (const delivery of ['caller', 'parent']) {
      await check(`${upstream.version}：flat 输入、路由参数、${delivery} delivery 与返回句柄保留`, async () => {
        const h = make();
        const spec = { ...h.flatSpec, delivery };
        const before = { ...spec };
        Object.freeze(spec.agentOptions);
        Object.freeze(spec);
        const activation = await startManagedActivation(h.ctx, spec);
        assert.equal(h.observations.starts, 1);
        const request = h.observations.requests[0];
        for (const key of ['parent', 'prompt', 'label', 'agentPreset', 'agentOptions', 'outputSchema', 'maxDepth']) {
          assert.strictEqual(request[key], spec[key], `provider 收到的 ${key} 不应改变`);
        }
        assert.ok(Object.hasOwn(request.agentOptions, 'reasoningEffort'));
        assert.equal(request.agentOptions.reasoningEffort, undefined);
        assert.equal(request.cwd, resolve('contract-fixture', 'child'));
        assert.equal(h.observations.materializations[0].delivery, delivery);
        assert.equal(h.observations.catalogs.length, delivery === 'parent' ? 1 : 0);
        assert.equal(request.signal.aborted, false);
        assert.deepEqual(spec, before, '兼容层不得修改输入');
        assert.equal(activation.childId, 'external-child');
        assert.equal((await activation.result).stopReason, 'completed');
        await activation.dispose();
        assert.deepEqual(h.observations.disposed, ['external-child']);
      });
    }
    await check(`${upstream.version}：provider 启动中的 abort 传播、真实 admission 回滚且不重试`, async () => {
      const h = make();
      const ready = Promise.withResolvers();
      const release = Promise.withResolvers();
      const originalStart = h.provider.start.bind(h.provider);
      h.provider.start = async request => {
        const run = await originalStart(request);
        ready.resolve(request);
        await release.promise;
        return run;
      };
      const reason = new Error('启动期间取消');
      const pending = startManagedActivation(h.ctx, h.flatSpec);
      const rejected = assert.rejects(async () => pending, error => error === reason);
      const request = await ready.promise;
      h.controller.abort(reason);
      assert.equal(request.signal.aborted, true);
      assert.strictEqual(request.signal.reason, reason);
      release.resolve();
      await rejected;
      assert.equal(h.observations.starts, 1);
      assert.deepEqual(h.observations.disposed, ['external-child']);
      assert.equal(h.observations.catalogs.length, 0);
    });
    await check(`${upstream.version}：provider 失败原样传播且只调用一次`, async () => {
      const h = make();
      const failure = new Error('provider 已开始，禁止改形状重试');
      h.observations.providerError = failure;
      await assert.rejects(async () => startManagedActivation(h.ctx, h.flatSpec), error => error === failure);
      assert.equal(h.observations.starts, 1);
    });
    await check(`${upstream.version}：预取消、无 provider、能力不支持、失效 parent 均无启动`, async () => {
      for (const scenario of ['aborted', 'missing-provider', 'capability', 'stale-parent', 'reserved-external-id', 'invalid-depth']) {
        const h = make();
        if (scenario === 'aborted') h.controller.abort(new Error('已取消'));
        if (scenario === 'missing-provider') h.subagents.providers.clear();
        if (scenario === 'capability') h.provider.capabilities.agentOptions = false;
        if (scenario === 'stale-parent') h.agents.store.delete(h.parent.id);
        if (scenario === 'reserved-external-id') h.flatSpec.childId = 'reserved';
        if (scenario === 'invalid-depth') h.flatSpec.maxDepth = -1;
        await rejectionWithoutStart(h, () => startManagedActivation(h.ctx, h.flatSpec));
      }
    });
  }
  if (!upstreamOnly) {
    await check('unsupported/mixed runtime：无副作用预判拒绝，零 startActivation/provider 调用', async () => {
      const [legacy, modern] = upstreams.map(createIsolatedRuntime);
      const cases = [
        { agents: {}, subagents: legacy.subagents },
        { agents: modern.agents, subagents: legacy.subagents },
        { agents: legacy.agents, subagents: modern.subagents },
        { agents: legacy.agents, subagents: {} },
      ];
      for (const ctx of cases) {
        let calls = 0;
        const actual = ctx.subagents;
        ctx.subagents = Object.create(actual);
        if (typeof actual.startActivation === 'function') {
          ctx.subagents.startActivation = (...args) => { calls++; return actual.startActivation(...args); };
        }
        await assert.rejects(async () => compatibility.startManagedActivation(ctx, legacy.flatSpec));
        assert.equal(calls, 0, '混合运行时必须在 startActivation 之前拒绝');
      }
      assert.equal(legacy.observations.starts + modern.observations.starts, 0);
    });
    await check('rc2：真实 provider identity fence 拒绝中途替换，不启动、不重试', async () => {
      const h = createIsolatedRuntime(upstreams[1]);
      h.ctx.workingDirectory.ensure = async () => {
        h.subagents.providers.set(h.provider.name, { ...h.provider });
        return resolve('contract-fixture');
      };
      await assert.rejects(async () => compatibility.startManagedActivation(h.ctx, h.flatSpec), error => error.code === 'PROVIDER_CHANGED');
      assert.equal(h.observations.starts, 0);
      assert.equal(h.observations.materializations.length, 1);
    });
  }
  return { mode: upstreamOnly ? '仅上游隔离基线' : '兼容层 + 双版本上游隔离契约', checks, commits: upstreams.map(({ version, commit }) => ({ version, commit })) };
}

export async function main(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--help') {
      console.log(`用法：node scripts/verify-runtime-contracts.mjs --rc1-source <rc1 源码目录> --rc2-source <rc2 源码目录> [--compat-module <模块路径>] [--upstream-only]\n\n离线执行固定官方源码中的隔离契约，不运行完整 Cordis Host。\n默认兼容层为项目 lib/runtime-compat.js；--upstream-only 只验证上游基线，不能作为兼容层验收。\n需要支持 node:module.stripTypeScriptTypes 的 Node（建议 22.13+ / 24+）。源码可用固定 commit 的官方 codeload 归档，脚本校验所有执行文件的 SHA-256。`);
      return;
    }
    if (key === '--upstream-only') { args.upstreamOnly = true; continue; }
    const names = { '--rc1-source': 'rc1Source', '--rc2-source': 'rc2Source', '--compat-module': 'compatModule' };
    assert.ok(names[key], `未知参数 ${key}`);
    assert.ok(argv[i + 1] && !argv[i + 1].startsWith('--'), `${key} 需要路径`);
    args[names[key]] = argv[++i];
  }
  assert.ok(args.rc1Source && args.rc2Source, '必须显式提供 --rc1-source 和 --rc2-source；脚本不会自动联网。使用 --help 查看说明。');
  const compatibility = args.upstreamOnly ? undefined : await import(args.compatModule
    ? pathToFileURL(resolve(args.compatModule)).href : new URL('../lib/runtime-compat.js', import.meta.url).href);
  const result = await verifyRuntimeContracts({ ...args, compatibility, onCheck: name => console.log(`通过：${name}`) });
  console.log(JSON.stringify({ ...result, passed: result.checks.length, limitation: '非完整 Host 集成；未启动 Cordis、真实 Session、外部 CLI 或 LLM。' }, null, 2));
  return result;
}

function realResolve(target) {
  try {
    return realpathSync(target);
  } catch {
    return resolve(target);
  }
}

function isMainEntrypoint() {
  if (!process.argv[1]) return false;
  const entry = realResolve(process.argv[1]);
  const current = realResolve(fileURLToPath(import.meta.url));
  return process.platform === 'win32' ? entry.toLowerCase() === current.toLowerCase() : entry === current;
}

if (isMainEntrypoint()) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
