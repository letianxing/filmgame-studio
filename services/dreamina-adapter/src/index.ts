import { execFile } from "node:child_process";
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rename, rmdir, stat, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function dreaminaNodeId() {
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
  return `node_${[...randomBytes(10)].map(b => alphabet[b % 32]).join('')}`;
}

export interface DreaminaModel {
  model: string;
  aliases?: string[];
  modes: Array<{
    name: string;
    flags?: Array<{ flag: string; values?: string[]; min?: number; max?: number }>;
    references?: {
      min: number;
      max: number;
      types?: Array<{ mediaType: string; min: number; max: number }>;
    };
  }>;
}
interface Envelope<T> {
  ok: boolean;
  data: T;
  error?: { code?: string; requiredAction?: string };
  meta?: { requestId?: string };
}
export class DreaminaError extends Error {
  constructor(
    readonly code: string,
    readonly requiredAction?: string,
  ) {
    super(`即梦：${code}${requiredAction ? `（${requiredAction}）` : ""}`);
  }
}
export class DreaminaPreflightError extends Error {}
export class DreaminaRejectedError extends Error {}
/** Official CLI boundary. OAuth and credit tokens never enter persistent job data. */
export class DreaminaAdapter {
  constructor(
    readonly executable: string,
    readonly profile = "default",
  ) {}
  call<T>(args: string[], timeout = 60_000): Promise<T> {
    return new Promise((resolve, reject) => {
      execFile(
        this.executable,
        [...args, "--profile", this.profile, "--format", "json", "--non-interactive"],
        { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" },
        (error, stdout, stderr) => {
          let result: Envelope<T>;
          try {
            result = JSON.parse(stdout.trim() || stderr.trim()) as Envelope<T>;
          } catch {
            reject(new DreaminaError(error ? "CLI_UNAVAILABLE" : "INVALID_JSON"));
            return;
          }
          if (!result.ok) {
            reject(
              new DreaminaError(result.error?.code ?? "CLI_FAILED", result.error?.requiredAction),
            );
            return;
          }
          resolve(result.data);
        },
      );
    });
  }
  auth() {
    return this.call<{ loggedIn: boolean; version: string }>(["auth", "status"]);
  }
  async models(): Promise<DreaminaModel[]> {
    return (await this.call<{ items: DreaminaModel[] }>(["model", "list", "--type", "video"]))
      .items;
  }
  async createCanvas(name: string, projectId: string) {
    return (
      await this.call<{ project: { projectId: string; webUrl: string } }>([
        "canvas",
        "create",
        name,
        "--project-id",
        projectId,
      ])
    ).project;
  }
  async saveCharacter(input: {
    canvasId: string;
    nodeId: string;
    updateId: string;
    title: string;
    prompt: string;
    ratio?: '3:4' | '16:9';
    refs?: string[];
  }) {
    const catalog = await this.call<{ items: DreaminaModel[] }>([
      "model",
      "list",
      "--type",
      "image",
    ]);
    const model = catalog.items.find((m) => m.model === "seedream_4.0");
    const mode = input.refs?.length ? 'i2i' : 't2i';
    const ratio = input.ratio ?? '3:4';
    const spec = model?.modes.find((m) => m.name === mode);
    if (
      !spec?.flags?.find((f) => f.flag === "--resolution")?.values?.includes("2K") ||
      !spec.flags.find((f) => f.flag === "--ratio")?.values?.includes(ratio)
    )
      throw new Error("当前即梦目录未提供角色参考图规格");
    await this.call([
      "node",
      "create",
      "image",
      "--project-id",
      input.canvasId,
      "--node-id",
      input.nodeId,
      "--update-id",
      input.updateId,
      "--title",
      input.title,
      "--mode",
      mode,
      "--prompt",
      input.prompt,
      "--model",
      model!.model,
      "--ratio",
      ratio,
      "--resolution",
      "2K",
      "--count",
      "1",
      ...(input.refs ?? []).flatMap(ref => ['--ref', ref]),
    ]);
    const result = await this.call<{
      nodes: Array<{ node?: { nodeId: string; generation?: { model?: string; prompt?: string } } }>;
    }>(["node", "show", "--project-id", input.canvasId, "--node-id", input.nodeId]);
    const saved = result.nodes.find((n) => n.node?.nodeId === input.nodeId)?.node?.generation;
    if (saved?.model !== model!.model || saved.prompt !== input.prompt)
      throw new Error("角色节点回读与方案不一致");
    return model!.model;
  }
  async saveVideo(input: {
    canvasId: string;
    nodeId: string;
    updateId: string;
    title: string;
    prompt: string;
    model: string;
    ratio: string;
    resolution: string;
    duration: number;
    refs?: string[];
    referenceTypes?: Array<'image' | 'audio' | 'video'>;
    mode?: 't2v' | 'm2v' | 'first_last_frame';
  }) {
    const mode = input.mode ?? (input.refs?.length ? "m2v" : "t2v");
    const refs = input.refs ?? [];
    const types = input.referenceTypes ?? refs.map(() => 'image' as const);
    if (types.length !== refs.length) throw new Error('Reference types do not match references');
    if (mode === 'first_last_frame' && (refs.length < 1 || refs.length > 2 || types.some(t => t !== 'image')))
      throw new Error('First/last frame mode requires one or two ordered image references');
    if (mode === 't2v' && refs.length) throw new Error('Text-to-video cannot use references');
    const models = await this.models();
    // The catalog may publish separate one-frame and two-frame entries for the same mode.
    const spec = models.find((m) => m.model === input.model)?.modes.find((m) =>
      m.name === mode && (refs.length === 0 ? !m.references || m.references.min === 0 :
        !!m.references && refs.length >= m.references.min && refs.length <= m.references.max &&
        types.every(t => m.references!.types?.some(r => r.mediaType === t)) &&
        m.references.types?.every(t => {
          const count = types.filter(v => v === t.mediaType).length;
          return count >= t.min && count <= t.max;
        })));
    if (!spec) throw new Error("当前即梦目录不支持所选模型与模式");
    if (input.refs?.length) {
      const types = input.referenceTypes ?? input.refs.map(() => 'image' as const);
      if (
        types.length !== input.refs.length ||
        input.refs.length < (spec.references?.min ?? Infinity) ||
        input.refs.length > (spec.references?.max ?? 0) ||
        types.some(type => !spec.references?.types?.some(t => t.mediaType === type)) ||
        spec.references?.types?.some(t => {
          const count = types.filter(type => type === t.mediaType).length;
          return count < t.min || count > t.max;
        })
      )
        throw new Error("参考素材类型或数量不符合所选模型限制");
    }
    for (const [flag, value] of [
      ["--ratio", input.ratio],
      ["--resolution", input.resolution],
    ] as const) {
      if (!spec.flags?.find((f) => f.flag === flag)?.values?.includes(value))
        throw new Error(`即梦当前不支持 ${flag}=${value}`);
    }
    const duration = spec.flags?.find((f) => f.flag === "--duration");
    if (
      !duration ||
      input.duration < (duration.min ?? Infinity) ||
      input.duration > (duration.max ?? -Infinity)
    )
      throw new Error("镜头时长不在即梦当前支持范围");
    const maxLength = (
      spec.flags?.find((f) => f.flag === "--prompt") as { maxLength?: number } | undefined
    )?.maxLength;
    if (maxLength && input.prompt.length > maxLength)
      throw new Error("镜头描述超过所选模型长度限制");
    const args = [
      "node",
      "create",
      "video",
      "--project-id",
      input.canvasId,
      "--node-id",
      input.nodeId,
      "--update-id",
      input.updateId,
      "--title",
      input.title,
      "--mode",
      mode,
      "--prompt",
      input.prompt,
      "--model",
      input.model,
      "--ratio",
      input.ratio,
      "--resolution",
      input.resolution,
      "--duration",
      String(input.duration),
      "--count",
      "1",
    ];
    for (const ref of input.refs ?? []) args.push("--ref", ref);
    await this.call(args);
    const saved = await this.call<{
      nodes: Array<{
        node?: {
          nodeId: string;
          generation?: {
            model?: string;
            mode?: string;
            prompt?: string;
            durationSeconds?: number;
            ratio?: string;
            resolution?: string;
            references: Array<{ id?: string; unavailableCode?: string }>;
          };
        };
      }>;
    }>(["node", "show", "--project-id", input.canvasId, "--node-id", input.nodeId]);
    const generation = saved.nodes.find((n) => n.node?.nodeId === input.nodeId)?.node?.generation;
    if (
      !generation ||
      generation.model !== input.model ||
      generation.mode !== mode ||
      generation.prompt !== input.prompt ||
      generation.durationSeconds !== input.duration ||
      generation.ratio !== input.ratio ||
      generation.resolution !== input.resolution ||
      generation.references.some((r) => r.unavailableCode) ||
      (mode === 'first_last_frame' && (generation.references.length !== refs.length ||
        refs.some((r, i) => generation.references[i]?.id !== r.slice(r.indexOf(':') + 1)))) ||
      (input.refs ?? []).some(
        (r) => !generation.references.some((g) => g.id === r.slice(r.indexOf(":") + 1)),
      )
    )
      throw new Error("即梦节点回读与镜头方案不一致，请检查画布");
  }
  quote(canvasId: string, nodeId: string) {
    return this.call<{
      totalMaxCredits: number;
      confirmable?: boolean;
      items: Array<{ nodeId: string; maxCredits?: number; error?: unknown }>;
    }>(["node", "quote", "--project-id", canvasId, "--node-id", nodeId]);
  }
  async run(canvasId: string, nodeId: string, submitId: string, ceiling: number) {
    const confirmation = await this.call<{ creditConfirmationToken: string }>([
      "node",
      "confirm",
      "--project-id",
      canvasId,
      "--node-id",
      nodeId,
      "--credit-ceiling",
      String(ceiling),
    ]).catch((error) => {
      throw new DreaminaPreflightError(error instanceof Error ? error.message : "积分确认失败");
    });
    if (!confirmation.creditConfirmationToken)
      throw new DreaminaPreflightError("即梦未返回积分授权");
    const result = await this.call<{
      items: Array<{
        nodeId: string;
        submitId: string;
        state: string;
        error?: { serviceCode: number; validation?: { reasonCode: string } };
      }>;
    }>([
      "node",
      "run",
      "--project-id",
      canvasId,
      "--node-id",
      nodeId,
      "--submit-id",
      submitId,
      "--credit-token",
      confirmation.creditConfirmationToken,
    ]);
    const item = result.items.find((i) => i.nodeId === nodeId && i.submitId === submitId);
    if (!item) throw new DreaminaError("SUBMISSION_UNCERTAIN");
    if (item.error || ["failed", "rejected"].includes(item.state.toLowerCase()))
      throw new DreaminaRejectedError(
        `即梦拒绝生成：${item.error?.validation?.reasonCode ?? item.error?.serviceCode ?? item.state}`,
      );
    return result;
  }
  status(canvasId: string, submitId: string) {
    return this.call<{
      state: string;
      resources: Array<{ resourceId: string; state: string }>;
      submission?: { state: string };
      submissionError?: { message: string };
    }>(["operation", "status", submitId, "--project-id", canvasId]);
  }
  async download(canvasId: string, resourceId: string, output: string) {
    // CLI 1.0.2 commits downloads via rename from its system temporary volume.
    // On Windows a workspace on another drive causes download_filesystem_failed.
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'filmgame-jimeng-'));
    const local = path.join(temporary, path.basename(output));
    const staging = `${output}.${randomUUID()}.incoming`;
    try {
      const receipt = await this.call<{ path: string; size: number; sha256: string }>(
        ['resource', 'download', resourceId, '--project-id', canvasId, '--output', local],
        5 * 60_000,
      );
      await mkdir(path.dirname(output), { recursive: true });
      await copyFile(local, staging);
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(staging)) hash.update(chunk);
      if ((await stat(staging)).size !== receipt.size || hash.digest('hex') !== receipt.sha256)
        throw new DreaminaError('DOWNLOAD_INTEGRITY_FAILED');
      await rename(staging, output);
      return { ...receipt, path: output };
    } finally {
      await unlink(local).catch(() => {});
      await unlink(staging).catch(() => {});
      await rmdir(temporary).catch(() => {});
    }
  }
}
