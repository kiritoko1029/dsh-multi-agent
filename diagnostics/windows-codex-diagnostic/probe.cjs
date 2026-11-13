'use strict';

// Read-only import probe. Run only in DSH's Electron runtime, in a fresh process.
// No initProfile/loadProfile/loadProfileDirectory: those APIs may rewrite files.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const TARGET = 'dsh-multi-agent';
let phase = 'arguments';

function redact(value) {
  return String(value).replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/([?&][^=&\s]+)=([^&\s]+)/g, '$1=[redacted]');
}
function line(key, value) { console.log(key + '=' + redact(value)); }
function readManifest(file) {
  if (fs.statSync(file).size > 1024 * 1024) throw new Error('Manifest exceeds diagnostic size limit');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--profile-dir', '--install-anchor'].includes(key) || !argv[i + 1] || result[key]) {
      throw new Error('Expected --profile-dir ABSOLUTE_PATH and optional --install-anchor ABSOLUTE_PACKAGE_JSON');
    }
    if (!path.isAbsolute(argv[i + 1])) throw new Error('Diagnostic paths must be absolute');
    result[key] = argv[i + 1];
  }
  if (!result['--profile-dir']) throw new Error('--profile-dir is required');
  return result;
}
function installAnchor(explicit) {
  const roots = [
    path.join(path.dirname(process.execPath), 'resources'),
    path.resolve(path.dirname(process.execPath), '..', 'Resources'),
    ...(typeof process.resourcesPath === 'string' ? [process.resourcesPath] : []),
  ];
  const candidates = explicit ? [explicit] : [
    ...roots.flatMap(root => ['app.asar', 'app'].map(app => path.join(root, app, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))),
    ...(process.env.DSH_INSTALL_DIR ? [path.join(process.env.DSH_INSTALL_DIR, 'package.json')] : []),
  ];
  for (const file of [...new Set(candidates)]) {
    if (!fs.existsSync(file)) continue;
    if (readManifest(file).name === '@deepseek-ai/dsh') return file;
  }
  throw new Error('Cannot locate the DSH CLI manifest beside this Electron executable. Specify -DshInstallDir (directory containing @deepseek-ai/dsh package.json).');
}
function errorDetails(error, depth = 0, seen = new Set()) {
  if (depth > 6 || seen.has(error)) return;
  if (error && typeof error === 'object') seen.add(error);
  line(depth ? 'CAUSE_' + depth : 'ERROR', error && error.stack ? error.stack : error);
  if (error && error.code) line('ERROR_CODE_' + depth, error.code);
  if (error && error.cause) errorDetails(error.cause, depth + 1, seen);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  line('DIAGNOSTIC', 'fresh-process DSH runtime resolution + import only; not live Host activation');
  line('NODE_EXE', process.execPath);
  line('NODE_VERSION', process.version);
  line('ELECTRON_VERSION', process.versions.electron || 'NOT_ELECTRON');
  if (!process.versions.electron) throw new Error('This is not DSH Electron. Do not use Volta/system node for this probe.');

  phase = 'locate_installation';
  const anchor = installAnchor(args['--install-anchor']);
  const cli = readManifest(anchor);
  line('DSH_INSTALL_ANCHOR', anchor);
  line('DSH_VERSION', cli.version);
  if (!['0.2.2-rc.1', '0.2.2-rc.2'].includes(cli.version)) {
    throw new Error('Diagnostic API validation is limited to DSH 0.2.2-rc.1/rc.2. No fallback bootstrap was attempted.');
  }

  phase = 'read_profile_metadata';
  const profileDir = path.resolve(args['--profile-dir']);
  const profileManifestPath = path.join(profileDir, 'package.json');
  const manifest = readManifest(profileManifestPath);
  const selected = manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles;
  const names = Array.isArray(selected) ? selected : [];
  if (names.length > 1000 || names.some(name => typeof name !== 'string')) throw new Error('Invalid or oversized bundle selection');
  line('PROFILE_DIR', profileDir);
  line('PLUGIN_SOURCE', manifest.dependencies && manifest.dependencies[TARGET] || '(not in dependencies)');
  line('PLUGIN_SELECTED', names.includes(TARGET));

  phase = 'load_dsh_resolution_api';
  const hostRequire = createRequire(anchor);
  const boot = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/dsh-app-boot')).href);
  const { Context } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/cordis')).href);
  for (const key of ['createRuntimeResolution', 'resolveBundleDir', 'PluginPackages']) {
    if (typeof boot[key] !== 'function') throw new Error('Unavailable DSH diagnostic API: ' + key);
  }

  // Reconstruct package-selection metadata without loading YAML, running !!js,
  // normalizing profiles, saving configuration, or mounting any plugin rows.
  const layers = [];
  const skippedBundles = [];
  for (const packageName of names) {
    try {
      const packageDir = boot.resolveBundleDir('diagnostic', packageName, anchor, profileDir);
      layers.push({ packageName, packageDir, patchPaths: [], patches: [] });
    } catch (error) {
      skippedBundles.push({ packageName, reason: 'unresolved during read-only package lookup' });
      // Do not dump unrelated package manifests or URL credentials.
      if (packageName === TARGET) errorDetails(error);
    }
  }
  line('UNRESOLVED_SELECTED_BUNDLE_COUNT', skippedBundles.length);
  const profile = { name: path.basename(profileDir), dir: profileDir, layers,
    patchPath: path.join(profileDir, 'cordis.patch.yml'), patches: [], skippedBundles };
  const home = process.env.DSH_HOME || path.dirname(path.dirname(profileDir));

  phase = 'install_process_local_resolver';
  const resolution = await boot.createRuntimeResolution({ installAnchor: anchor, profile, home });
  const ctx = new Context();
  // This service only registers process-local resolution/worker environment data.
  // It does not initialize a profile, load settings, mount bundles or start servers.
  const packages = new boot.PluginPackages(ctx, { resolution });
  if (!packages.resolution) throw new Error('DSH package resolver was not installed');
  for (const name of ['@deepseek-ai/dsh-util-time', '@deepseek-ai/dsh-subagent', '@deepseek-ai/dsh-sdk-protocol']) {
    const entry = resolution.entries.find(item => item.name === name);
    line('HOST_MAP ' + name, entry ? entry.version + ' ' + entry.packageDir : '(no mapped entry; native local lookup may still resolve)');
  }

  phase = 'locate_installed_plugin';
  const profileRequire = createRequire(profileManifestPath);
  const entry = profileRequire.resolve(TARGET + '/codex-provider');
  const info = packages.packageOf(TARGET, pathToFileURL(profileManifestPath).href);
  if (!info) throw new Error('Installed plugin metadata could not be resolved');
  line('PLUGIN_VERSION', info.version);
  line('PLUGIN_DIRECTORY', info.dir);
  line('CODEX_ENTRY', entry);
  for (const relative of ['codex-provider.js', 'lib/codex-run.js', 'lib/provider-process-contract.js']) {
    const file = path.join(info.dir, relative);
    line('FILE ' + relative, fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : '(missing)');
  }

  phase = 'import_codex_with_dsh_resolver';
  const module = await import(pathToFileURL(entry).href);
  if (typeof module.apply !== 'function') throw new Error('Codex module has no apply export');
  line('DSH_RESOLVER_IMPORT', 'IMPORT_OK');
  line('PLUGIN_EXPORT_NAME', module.name);
  line('NOT_EXECUTED', 'plugin apply, CLI/model task, configuration mutation, dependency installation, live Host cache refresh');
  line('LIMITATION', 'Uses DSH runtime and resolver in a separate process. Does not reproduce live Loader state, YAML overrides or cached modules. If the UI still fails, capture the live Host cause.');
}

module.exports = { main, parseArgs, redact };
if (require.main === module) {
  const watchdog = setTimeout(() => {
    line('FAILED_AT', phase);
    line('ERROR', 'Diagnostic import timed out after 45 seconds');
    process.exit(2);
  }, 45000);
  const finish = code => {
    clearTimeout(watchdog);
    // Flush captured output before exiting only this dedicated diagnostic process.
    process.stdout.write('', () => process.stderr.write('', () => process.exit(code)));
  };
  main().then(() => finish(0), error => {
    line('FAILED_AT', phase);
    errorDetails(error);
    finish(1);
  });
}
