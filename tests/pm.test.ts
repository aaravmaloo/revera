import { describe, it, expect } from 'vitest';
import { getInstallCommand, detectPackageManager } from '../src/utils/pm.js';

describe('Package Manager Helpers', () => {
  describe('getInstallCommand', () => {
    it('returns the correct install arguments for npm', () => {
      const npmInstall = getInstallCommand('npm', 'express', false);
      expect(npmInstall.cmd).toBe('npm');
      expect(npmInstall.args).toEqual(['install', 'express']);

      const npmDevInstall = getInstallCommand('npm', 'express', true);
      expect(npmDevInstall.cmd).toBe('npm');
      expect(npmDevInstall.args).toEqual(['install', '-D', 'express']);
    });

    it('returns the correct install arguments for pnpm', () => {
      const pnpmInstall = getInstallCommand('pnpm', 'express', false);
      expect(pnpmInstall.cmd).toBe('pnpm');
      expect(pnpmInstall.args).toEqual(['add', 'express']);

      const pnpmDevInstall = getInstallCommand('pnpm', 'express', true);
      expect(pnpmDevInstall.cmd).toBe('pnpm');
      expect(pnpmDevInstall.args).toEqual(['add', '-D', 'express']);
    });

    it('returns the correct install arguments for yarn', () => {
      const yarnInstall = getInstallCommand('yarn', 'express', false);
      expect(yarnInstall.cmd).toBe('yarn');
      expect(yarnInstall.args).toEqual(['add', 'express']);

      const yarnDevInstall = getInstallCommand('yarn', 'express', true);
      expect(yarnDevInstall.cmd).toBe('yarn');
      expect(yarnDevInstall.args).toEqual(['add', '--dev', 'express']);
    });

    it('returns the correct install arguments for bun', () => {
      const bunInstall = getInstallCommand('bun', 'express', false);
      expect(bunInstall.cmd).toBe('bun');
      expect(bunInstall.args).toEqual(['add', 'express']);

      const bunDevInstall = getInstallCommand('bun', 'express', true);
      expect(bunDevInstall.cmd).toBe('bun');
      expect(bunDevInstall.args).toEqual(['add', '-D', 'express']);
    });
  });

  describe('detectPackageManager', () => {
    it('resolves to configured package manager when not set to auto', () => {
      // Config is mocked by loading DEFAULT_CONFIG, but we can verify it doesn't crash
      const detected = detectPackageManager();
      expect(['npm', 'pnpm', 'yarn', 'bun']).toContain(detected);
    });
  });
});
