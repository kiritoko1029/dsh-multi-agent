import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOfficialSource, verifyRuntimeContracts } from '../scripts/verify-runtime-contracts.mjs';

const execFileAsync = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/verify-runtime-contracts.mjs', import.meta.url));
const invoke = (...args) => execFileAsync(process.execPath, [script, ...args], { timeout: 15_000 });

test('真实契约脚本说明必须明确离线输入与隔离边界', async () => {
  const { stdout } = await invoke('--help');
  assert.match(stdout, /--rc1-source/);
  assert.match(stdout, /--rc2-source/);
  assert.match(stdout, /不运行完整 Cordis Host/);
  assert.match(stdout, /不能作为兼容层验收/);
});

test('缺少源码参数或拼错参数硬失败，不自动下载或静默跳过', async () => {
  for (const args of [[], ['--rc1-source'], ['--rc1-soruce', 'somewhere']]) {
    await assert.rejects(invoke(...args), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /必须显式提供|需要路径|未知参数/);
      return true;
    });
  }
});

test('源码指纹在求值前验证，拒绝错误版本或改过的实现', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-contract-fingerprint-'));
  try {
    const agent = join(directory, 'packages/core/agent/src');
    await mkdir(agent, { recursive: true });
    await writeFile(join(agent, 'index.ts'), 'throw new Error("不应求值")\n');
    await assert.rejects(loadOfficialSource('rc1', directory), /rc1 源码指纹不符/);
    await assert.rejects(loadOfficialSource('rc2', directory), /rc2 源码指纹不符/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const rc1Source = process.env.DSH_RC1_SOURCE;
const rc2Source = process.env.DSH_RC2_SOURCE;
const requested = rc1Source !== undefined || rc2Source !== undefined;
test('显式本地源码运行双版本真实隔离契约', {
  skip: requested ? false : '需要 DSH_RC1_SOURCE 与 DSH_RC2_SOURCE；默认测试不下载上游源码',
  timeout: 30_000,
}, async () => {
  assert.ok(rc1Source && rc2Source, '两个源码环境变量必须同时提供');
  const compatibility = await import('../lib/runtime-compat.js');
  const result = await verifyRuntimeContracts({ rc1Source, rc2Source, compatibility });
  assert.equal(result.mode, '兼容层 + 双版本上游隔离契约');
  assert.ok(result.checks.length >= 18);
  assert.deepEqual(result.commits.map(item => item.version), ['rc1', 'rc2']);
});
