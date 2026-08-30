import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { ProductionJob, StoryModel } from '@filmgame/shared-types';

import { evaluateReleaseGates, type ReleaseManifest } from '../src/index.js';

const story = JSON.parse(
  readFileSync(new URL('../../../examples/snowbound-hotel/story.json', import.meta.url), 'utf8'),
) as StoryModel;
story.validation = { validatedAt: new Date().toISOString(), valid: true, issues: [] };

test('development manifest cannot masquerade as publish-ready', () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL('../../../examples/snowbound-hotel/asset-manifest.json', import.meta.url),
      'utf8',
    ),
  ) as ReleaseManifest;
  const result = evaluateReleaseGates({
    story,
    productionJobs: [],
    manifest,
    unrealToolchainReady: false,
  });
  assert.equal(result.ready, false);
  assert.ok(result.issues.some((issue) => issue.code === 'ASSET_NOT_APPROVED'));
  assert.ok(result.issues.some((issue) => issue.code === 'UNREAL_TOOLCHAIN_UNAVAILABLE'));
});

test('all release gates must pass together', () => {
  const hash = `sha256:${'a'.repeat(64)}`;
  const jobs: ProductionJob[] = [
    {
      id: 'package-job',
      type: 'PACKAGE',
      status: 'SUCCEEDED',
      dependencies: [],
      attempt: 1,
      maxAttempts: 1,
    },
  ];
  const targets = ['COLYSEUS', 'COMPANION_WEB', 'UNREAL_WINDOWS', 'PLAYTEST'] as const;
  const result = evaluateReleaseGates({
    story,
    productionJobs: jobs,
    manifest: {
      projectId: story.projectId,
      storyVersion: story.storyVersion,
      productionVersion: 1,
      assets: [
        {
          id: 'approved-asset',
          status: 'APPROVED',
          sha256: hash,
          provenance: {
            source: 'BUILT', referenceAssetIds: [], referenceLicenseIds: [],
            createdAt: '2026-08-31T00:00:00.000Z', approval: 'HUMAN_APPROVED',
            commercialUseStatus: 'APPROVED',
          },
          license: { commercialUseApproved: true, commercialUseStatus: 'APPROVED', licenseId: 'FIRST_PARTY' },
        },
      ],
      runtimePackages: targets.map((target) => ({
        id: `package-${target.toLowerCase()}`,
        target,
        status: 'READY',
        sha256: hash,
      })),
    },
    unrealToolchainReady: true,
  });
  assert.deepEqual(result, { ready: true, issues: [] });
});

test('unknown, non-commercial and missing provenance assets block release', () => {
  const hash = `sha256:${'b'.repeat(64)}`;
  const result = evaluateReleaseGates({
    story,
    productionJobs: [],
    manifest: {
      projectId: story.projectId, storyVersion: story.storyVersion, productionVersion: 1,
      assets: [
        { id: 'unknown-asset', status: 'APPROVED', sha256: hash, license: { commercialUseApproved: false, commercialUseStatus: 'UNKNOWN' } },
        { id: 'non-commercial', status: 'APPROVED', sha256: hash, provenance: { source: 'LICENSED', referenceAssetIds: [], referenceLicenseIds: [], createdAt: '2026-08-31T00:00:00.000Z', approval: 'HUMAN_APPROVED', commercialUseStatus: 'NON_COMMERCIAL' }, license: { commercialUseApproved: false, commercialUseStatus: 'NON_COMMERCIAL' } },
      ],
      runtimePackages: [],
    },
    unrealToolchainReady: true,
    requiredTargets: [],
  });
  assert.equal(result.ready, false);
  assert.ok(result.issues.some((issue) => issue.code === 'MISSING_PROVENANCE'));
  assert.ok(result.issues.some((issue) => issue.code === 'UNKNOWN_LICENSE'));
  assert.ok(result.issues.some((issue) => issue.code === 'NON_COMMERCIAL_LICENSE'));
});
