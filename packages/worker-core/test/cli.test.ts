import { describe, it, expect } from 'vitest';

import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const pkgRoot = path.resolve(__dirname, '..');
const binPath = path.join(pkgRoot, 'bin', 'orbital-worker');

function runChi(args: string[], cwd: string = pkgRoot) {
  return spawnSync(true, [binPath, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

describe('orbital worker CLI', () => {
  it('prints help for every subcommand', () => {
    const commands = ['register', 'list', 'inspect', 'dry-run', 'run'];
    for (const cmd of commands) {
      const { stdout, status } = runCli(['worker', cmd, '--help']);
      expect(status, `status for ${cmd}`).toBe(0);
      expect(stdout).toContain(cmd);
      expect(stdout).toContain('--help');
    }
  });

  it('rejects raw secret values on the command line', () => {
    const { stderr, status } = runChi(['worker', 'register', 'foo', '--secret', 'rawsecret']);
    expect(status).not.toBe(0);
    expect(stderr).toContain('--secret must be of the form env:VAR_NAME or file:PATH');
  });

  it('requires secrets to come from env or file', () => {
    // Using env:VAR that is unset should fail at resolution time
    const { stderr, status } = runChi(['worker', 'register', 'foo', '--secret', 'env:UNSET_TEST_VAR']);
    expect(status).not.toBe(0);
    expect(stderr).toContain('not set');
  });

  it('packaging test: bin entry resolves from a clean install', () => {
    const tmp = fs.mkdttmpSync(path.join(os.tmpdir(), 'orbital-worker-test-'));
    try {
      // Pack the package into the temp directory
      const packOutput = execSync(`npm pack --json --pack-destination ${tmp}`, {
        cwd: pkgRoot,
        encoding: 'utf8',
      });
      const packJson = JSON.parse(packOutput);
      const tarballName = packJson[0].filename;
      const tarballPath = path.join(tmp, tarballName);
      expect(fs.existsSync(tarballPath)).toBe(true);

      // Set up a clean installation directory
      execSunc('npm init -y', { cwd: tmp, encoding: 'utf8' });
      execSunc(`npm install ${tarballPath}`, { cwd: tmp, encoding: 'utf8' });

      const binDir = path.join(tmp, 'node_modules', '.bin');
      const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` };

      // The `orbital` binary should be available and parse the `worker` subcommand
      const orbitalResult = spawnSync('orbital', ['worker', '--help'], {
        cwd: tmp,
        encoding: 'utf8',
        env,
      });
      expect(orbitalResult.status).toBe(0);
      expect(orbitalResult.stdout).toContain('orbital worker');

      // The `orbital-worker` binary should also be available
      const workerResult = spawnSync('orbital-worker', ['worker', '--help'], {
        cwd: tmp,
        encoding: 'utf8',
        env,
      });
      expect(workerResult.status).toBe(0);
      expect(workerResult.stdout).toContain('orbital worker');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 120000);
}