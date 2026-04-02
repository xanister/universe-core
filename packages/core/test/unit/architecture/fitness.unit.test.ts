/**
 * Architecture fitness functions.
 *
 * These tests encode structural invariants about the package graph.
 * They run with `pnpm test` and catch boundary violations before code review.
 *
 * Added by FEAT-416 (Quality Gate).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readPackageJson(pkgDir: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} {
  return JSON.parse(readFileSync(join(ROOT, pkgDir, 'package.json'), 'utf-8'));
}

function getWorkspaceDeps(pkgDir: string): string[] {
  const pkg = readPackageJson(pkgDir);
  return Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith('@dmnpc/'));
}

/** Recursively collect .ts/.tsx files under a directory. */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
        results.push(full);
      }
    }
  };
  walk(join(ROOT, dir));
  return results;
}

/** Extract `@dmnpc/<name>` package names from import statements in a file. */
function extractDmnpcImports(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf-8');
  const re = /from\s+['"](@dmnpc\/[\w-]+)/g;
  const imports = new Set<string>();
  let m;
  while ((m = re.exec(content)) !== null) {
    imports.add(m[1]);
  }
  return [...imports];
}

// ---------------------------------------------------------------------------
// Package boundary rules
//
// Each entry defines the ONLY @dmnpc/* packages a package may depend on.
// If a new dependency is needed, update this list deliberately.
// ---------------------------------------------------------------------------

const ALLOWED_DEPS: Record<string, string[]> = {
  'packages/types': [],
  'packages/data': [],
  'packages/core': ['@dmnpc/types', '@dmnpc/data'],
  'packages/rulesets': ['@dmnpc/types'],
  'packages/agent-tools': ['@dmnpc/types'],
  'packages/sprites': ['@dmnpc/core', '@dmnpc/types'],
  'packages/generation': ['@dmnpc/core', '@dmnpc/data', '@dmnpc/sprites', '@dmnpc/types'],
  'packages/studio': [
    '@dmnpc/core',
    '@dmnpc/data',
    '@dmnpc/generation',
    '@dmnpc/types',
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('architecture fitness functions', () => {
  describe('package dependency boundaries', () => {
    for (const [pkgDir, allowed] of Object.entries(ALLOWED_DEPS)) {
      it(`${pkgDir} only depends on allowed packages`, () => {
        const actual = getWorkspaceDeps(pkgDir);
        const forbidden = actual.filter((dep) => !allowed.includes(dep));
        expect(forbidden, `${pkgDir} has forbidden workspace deps: ${forbidden.join(', ')}`).toEqual(
          [],
        );
      });
    }
  });

  describe('core source isolation', () => {
    it('core source files do not import from domain packages', () => {
      const domainPkgs = [
        '@dmnpc/generation',
        '@dmnpc/studio',
        '@dmnpc/sprites',
        '@dmnpc/rulesets',
        '@dmnpc/agent-tools',
      ];

      const files = collectSourceFiles('packages/core/src');
      const violations: string[] = [];

      for (const file of files) {
        const imports = extractDmnpcImports(file);
        for (const imp of imports) {
          if (domainPkgs.includes(imp)) {
            const rel = relative(ROOT, file);
            violations.push(`${rel} imports ${imp}`);
          }
        }
      }

      expect(violations, 'Core must not import domain packages').toEqual([]);
    });
  });

  describe('types package constraints', () => {
    it('types has no workspace dependencies', () => {
      const deps = getWorkspaceDeps('packages/types');
      expect(deps, 'types must have zero @dmnpc/* dependencies').toEqual([]);
    });

    it('runtime code in types does not grow beyond known files', () => {
      // These files currently contain exported functions — grandfathered.
      // New files must NOT add runtime functions to the types package.
      const KNOWN_RUNTIME_FILES = new Set([
        'chat.ts',
        'core.ts',
        'entities.ts',
        'movement.ts',
        'place-templates.ts',
        'plot.ts',
        'terrain-layers.ts',
        'weather.ts',
      ]);

      const funcRe = /^export\s+(async\s+)?function\s/m;
      const files = readdirSync(join(ROOT, 'packages/types/src')).filter((f) => f.endsWith('.ts'));
      const newRuntimeFiles: string[] = [];

      for (const file of files) {
        if (KNOWN_RUNTIME_FILES.has(file)) continue;
        const content = readFileSync(join(ROOT, 'packages/types/src', file), 'utf-8');
        if (funcRe.test(content)) {
          newRuntimeFiles.push(file);
        }
      }

      expect(
        newRuntimeFiles,
        `New files with runtime functions in types/: ${newRuntimeFiles.join(', ')}. ` +
          'Add to KNOWN_RUNTIME_FILES if intentional, or move functions to the consuming package.',
      ).toEqual([]);
    });
  });

  describe('no relative cross-package imports', () => {
    it('source files use @dmnpc/* imports, not relative paths to other packages', () => {
      const crossPkgRe = /from\s+['"]\.\.\/.*\/(packages|apps)\//;
      const violations: string[] = [];

      for (const pkgDir of Object.keys(ALLOWED_DEPS)) {
        const srcDir = `${pkgDir}/src`;
        try {
          const files = collectSourceFiles(srcDir);
          for (const file of files) {
            const content = readFileSync(file, 'utf-8');
            if (crossPkgRe.test(content)) {
              violations.push(relative(ROOT, file));
            }
          }
        } catch {
          // Package might not have src/ dir (e.g. data)
        }
      }

      expect(violations, 'Files using relative cross-package imports').toEqual([]);
    });
  });
});
