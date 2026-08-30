import { spawn } from 'node:child_process';
import path from 'node:path';

import type {
  AssetProvenance,
  CommercialUseStatus,
  ProductionJob,
  StoryModel,
} from '@filmgame/shared-types';

export interface ReleaseAsset {
  id: string;
  status:
    | 'DRAFT'
    | 'GENERATED'
    | 'REVIEW'
    | 'QA'
    | 'APPROVED'
    | 'LOCKED'
    | 'DEPRECATED'
    | 'REJECTED'
    | 'MISSING';
  sha256: string;
  provenance?: AssetProvenance;
  license?: {
    commercialUseApproved: boolean;
    commercialUseStatus?: CommercialUseStatus;
    licenseId?: string;
    referenceLicenseIds?: string[];
  };
}

export interface ReleaseRuntimePackage {
  id: string;
  target: 'COLYSEUS' | 'COMPANION_WEB' | 'UNREAL_WINDOWS' | 'PLAYTEST';
  status: 'BUILDING' | 'READY' | 'FAILED' | 'PUBLISHED';
  sha256: string;
}

export interface ReleaseManifest {
  projectId: string;
  storyVersion: number;
  productionVersion: number;
  assets: ReleaseAsset[];
  runtimePackages: ReleaseRuntimePackage[];
}

export interface ReleaseGateIssue {
  code: string;
  severity: 'BLOCKER' | 'WARNING';
  message: string;
  entityId?: string;
}

export interface ReleaseGateResult {
  ready: boolean;
  issues: ReleaseGateIssue[];
}

export function evaluateReleaseGates(input: {
  story: StoryModel;
  productionJobs: ProductionJob[];
  manifest: ReleaseManifest;
  unrealToolchainReady: boolean;
  requiredTargets?: ReleaseRuntimePackage['target'][];
}): ReleaseGateResult {
  const issues: ReleaseGateIssue[] = [];
  if (!input.story.validation?.valid) {
    issues.push(blocker('STORY_INVALID', 'Story validation must pass before release.'));
  }
  for (const job of input.productionJobs) {
    if (job.status !== 'SUCCEEDED') {
      issues.push(
        blocker(
          'PRODUCTION_JOB_INCOMPLETE',
          `Production job ${job.id} is ${job.status}.`,
          job.id,
        ),
      );
    }
  }
  for (const asset of input.manifest.assets) {
    if (!['APPROVED', 'LOCKED'].includes(asset.status)) {
      issues.push(blocker('ASSET_NOT_APPROVED', `Asset ${asset.id} is ${asset.status}.`, asset.id));
    }
    if (!/^sha256:[a-f0-9]{64}$/iu.test(asset.sha256)) {
      issues.push(blocker('ASSET_HASH_INVALID', `Asset ${asset.id} has no valid SHA-256.`, asset.id));
    }
    if (!asset.provenance) {
      issues.push(blocker('MISSING_PROVENANCE', `Asset ${asset.id} has no provenance record.`, asset.id));
    }
    const commercialStatus =
      asset.provenance?.commercialUseStatus ??
      asset.license?.commercialUseStatus ??
      (asset.license?.commercialUseApproved ? 'APPROVED' : 'UNKNOWN');
    if (commercialStatus !== 'APPROVED' || !asset.license?.commercialUseApproved) {
      issues.push(
        blocker(
          commercialBlockerCode(commercialStatus),
          `Asset ${asset.id} commercial status is ${commercialStatus}.`,
          asset.id,
        ),
      );
    }
    if (
      asset.provenance?.source === 'GENERATED' &&
      (!asset.provenance.provider || !asset.provenance.modelLicense)
    ) {
      issues.push(
        blocker(
          'MISSING_MODEL_LICENSE',
          `Generated asset ${asset.id} lacks provider/model license evidence.`,
          asset.id,
        ),
      );
    }
    if (
      asset.provenance?.referenceAssetIds.length &&
      asset.provenance.referenceLicenseIds.length < asset.provenance.referenceAssetIds.length
    ) {
      issues.push(
        blocker(
          'MISSING_REFERENCE_LICENSE',
          `Asset ${asset.id} has references without matching license evidence.`,
          asset.id,
        ),
      );
    }
    if (
      asset.provenance?.provider === 'filmgame-reference' ||
      asset.provenance?.sourceUri?.replace(/\\/gu, '/').includes('/filmgame/')
    ) {
      issues.push(
        blocker(
          'REFERENCE_ONLY_SOURCE',
          `Asset ${asset.id} traces to the non-commercial filmgame reference repository.`,
          asset.id,
        ),
      );
    }
  }
  const requiredTargets = input.requiredTargets ?? [
    'COLYSEUS',
    'COMPANION_WEB',
    'UNREAL_WINDOWS',
    'PLAYTEST',
  ];
  for (const target of requiredTargets) {
    const candidate = input.manifest.runtimePackages.find((item) => item.target === target);
    if (!candidate || candidate.status !== 'READY') {
      issues.push(blocker('RUNTIME_PACKAGE_NOT_READY', `${target} package is not READY.`));
    }
  }
  if (!input.unrealToolchainReady) {
    issues.push(
      blocker(
        'UNREAL_TOOLCHAIN_UNAVAILABLE',
        'Visual Studio C++ Build Tools and Windows SDK are required for Win64 packaging.',
      ),
    );
  }
  return { ready: !issues.some((issue) => issue.severity === 'BLOCKER'), issues };
}

function commercialBlockerCode(status: CommercialUseStatus): string {
  return {
    UNKNOWN: 'UNKNOWN_LICENSE',
    REVIEW_REQUIRED: 'LICENSE_REVIEW_REQUIRED',
    APPROVED: 'ASSET_LICENSE_NOT_APPROVED',
    NON_COMMERCIAL: 'NON_COMMERCIAL_LICENSE',
    RESTRICTED: 'RESTRICTED_LICENSE',
    EXPIRED: 'EXPIRED_LICENSE',
  }[status];
}

export interface UnrealBuildConfig {
  automationToolPath: string;
  projectPath: string;
  archiveDirectory: string;
  targetName?: string;
}

export interface UnrealBuildResult {
  exitCode: number;
  startedAt: string;
  completedAt: string;
  stdout: string;
  stderr: string;
}

export class UnrealBuildService {
  constructor(readonly config: UnrealBuildConfig) {
    assertAbsolute(config.automationToolPath, 'automationToolPath');
    assertAbsolute(config.projectPath, 'projectPath');
    assertAbsolute(config.archiveDirectory, 'archiveDirectory');
  }

  buildWindowsShipping(signal?: AbortSignal): Promise<UnrealBuildResult> {
    const args = [
      'BuildCookRun',
      `-project=${this.config.projectPath}`,
      ...(this.config.targetName ? [`-target=${this.config.targetName}`] : []),
      '-noP4',
      '-platform=Win64',
      '-clientconfig=Shipping',
      '-build',
      '-cook',
      '-stage',
      '-pak',
      '-archive',
      `-archivedirectory=${this.config.archiveDirectory}`,
      '-utf8output',
      '-unattended',
    ];
    return run(this.config.automationToolPath, args, signal);
  }
}

function blocker(code: string, message: string, entityId?: string): ReleaseGateIssue {
  return entityId
    ? { code, severity: 'BLOCKER', message, entityId }
    : { code, severity: 'BLOCKER', message };
}

function assertAbsolute(candidate: string, field: string): void {
  if (!path.isAbsolute(candidate)) throw new Error(`${field} must be absolute`);
}

function run(executable: string, args: string[], signal?: AbortSignal): Promise<UnrealBuildResult> {
  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString();
    const child = spawn(executable, args, {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const abort = (): void => {
      child.kill();
    };
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      signal?.removeEventListener('abort', abort);
      const result = {
        exitCode: code ?? -1,
        startedAt,
        completedAt: new Date().toISOString(),
        stdout,
        stderr,
      };
      if (code === 0) resolve(result);
      else reject(Object.assign(new Error(`Unreal AutomationTool failed with code ${code}`), { result }));
    });
  });
}
