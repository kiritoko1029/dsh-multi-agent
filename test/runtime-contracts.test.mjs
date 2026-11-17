import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOfficialSource } from '../scripts/verify-runtime-contracts.mjs';

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
