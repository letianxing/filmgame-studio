import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { LLMProvider } from "../../../packages/provider-sdk/src/index.js";
import { RemoteVideoProvider } from "../../../services/remote-video-adapter/src/index.js";
import { DreaminaAdapter } from "../../../services/dreamina-adapter/src/index.js";
import { MediaPipeline } from "../../../services/media-pipeline/src/index.js";
import { ComicService, message, type ComicProject } from "./comic-service.js";
import { importReferenceCandidate, bindReferenceCandidate } from './comic-reference-import.js';
import type { Ratio } from "../../../packages/comic-engine/src/index.js";
import { harnessProgress, type HarnessPolicy } from './comic-harness.js';
import type { BillingReceipt } from './comic-cost-ledger.js';

export function createComicService(llm: LLMProvider | null) {
  return new ComicService({
    root: path.resolve(process.env.COMIC_PROJECT_ROOT ?? ".local/comic-projects"),
    llm,
    video: process.env.REMOTE_VIDEO_BASE_URL
      ? new RemoteVideoProvider({
          baseUrl: process.env.REMOTE_VIDEO_BASE_URL,
          model: process.env.REMOTE_VIDEO_MODEL ?? "seedance-production",
          ...(process.env.REMOTE_VIDEO_API_TOKEN
            ? { token: process.env.REMOTE_VIDEO_API_TOKEN }
            : {}),
        })
      : null,
    dreamina: process.env.DREAMINA_CLI_PATH
      ? new DreaminaAdapter(
          process.env.DREAMINA_CLI_PATH,
          process.env.DREAMINA_PROFILE ?? "default",
        )
      : null,
    media: new MediaPipeline({
      ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
      ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe",
      defaultVideoCodec: process.env.MEDIA_VIDEO_CODEC ?? "libopenh264",
    }),
  });
}
export async function comicRoute(
  service: ComicService,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!url.pathname.startsWith("/v1/comic/")) return false;
  if (request.method === 'POST' && (!request.headers['content-type']?.startsWith('application/json') || (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host))) {
    response.writeHead(403, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'REQUEST_ORIGIN_REJECTED' })); return true;
  }
  const send = (body: unknown, status = 200) => {
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify(body));
    return true;
  };
  const stale = (p: ComicProject, r: ComicProject["runs"][number]) => {
    try {
      return r.inputHash !== service.hash(p, r.shotId);
    } catch {
      return true;
    }
  };
  const view = (p: ComicProject) => ({
    ...p,
    harness: harnessProgress(p, r => !stale(p, r)),
    busy: service.busy.has(p.id),
    runs: p.runs.map((r) => ({ ...r, stale: stale(p, r) })),
    exports: p.exports.map((e) => ({ ...e, stale: !service.exportIsCurrent(p, e) })),
  });
  try {
    if (url.pathname === "/v1/comic/health") {
      const [llm, video, dreamina, media] = await Promise.all([
        service.config.llm?.health(),
        service.config.video?.health(),
        service.config.dreamina?.auth().catch(() => ({ loggedIn: false, version: "" })),
        service.config.media.health(),
      ]);
      return send({
        llm: llm?.status ?? "UNCONFIGURED",
        video: video?.status ?? "UNCONFIGURED",
        dreamina: dreamina?.loggedIn ? "HEALTHY" : "LOGIN_REQUIRED",
        cliVersion: dreamina?.version,
        media: media.status,
      });
    }
    if (url.pathname === "/v1/comic/models" && request.method === "GET")
      return send({ models: await service.requireDreamina().models() });
    if (url.pathname === "/v1/comic/projects") {
      if (request.method === "GET")
        return send({
          projects: (await service.list()).map((p) => ({
            id: p.id,
            title: p.title,
            phase: p.phase,
            updatedAt: p.updatedAt,
          })),
        });
      if (request.method === "POST") {
        const body = await readBody(request);
        return send(
          {
            project: view(
              await service.create({
                idea: String(body.idea ?? ""),
                style: String(body.style ?? "精致国漫，电影感光影"),
                ratio: body.ratio as Ratio,
                episodeCount: Number(body.episodeCount),
                episodeSeconds: Number(body.episodeSeconds),
              }),
            ),
          },
          201,
        );
      }
    }
    const match = url.pathname.match(/^\/v1\/comic\/projects\/([a-f0-9-]{36})(?:\/(.*))?$/);
    if (!match) return send({ error: "接口不存在" }, 404);
    const id = match[1]!;
    const action = match[2] ?? "";
    if (request.method === "GET" && action.startsWith("assets/")) {
      const name = action.slice(7);
      const asset = await service.asset(id, name);
      if (name.endsWith(".srt") && url.searchParams.get("format") === "vtt") {
        const { readFile } = await import("node:fs/promises");
        const srt = await readFile(asset.absolute, "utf8");
        response.writeHead(200, { "content-type": "text/vtt; charset=utf-8" });
        response.end(`WEBVTT\n\n${srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}`);
        return true;
      }
      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = range ? Number(range[1]) : 0;
      const end = range && range[2] ? Math.min(Number(range[2]), asset.size - 1) : asset.size - 1;
      if (asset.size && (start > end || start >= asset.size)) {
        response.writeHead(416, { "content-range": `bytes */${asset.size}` });
        response.end();
        return true;
      }
      const type = name.endsWith(".mp4")
        ? "video/mp4"
        : name.endsWith(".srt")
          ? "application/x-subrip"
          : name.endsWith(".png")
            ? "image/png"
            : "image/jpeg";
      response.writeHead(range ? 206 : 200, {
        "content-type": type,
        "content-length": Math.max(0, end - start + 1),
        "accept-ranges": "bytes",
        ...(range ? { "content-range": `bytes ${start}-${end}/${asset.size}` } : {}),
        ...(url.searchParams.has("download")
          ? { "content-disposition": `attachment; filename="${name}"` }
          : {}),
      });
      if (!asset.size) response.end();
      else createReadStream(asset.absolute, { start, end }).pipe(response);
      return true;
    }
    if (request.method === "GET" && !action) return send({ project: view(await service.get(id)) });
    if (request.method === 'GET' && action === 'reviewed-manifest')
      return send(await service.reviewedManifest(id));
    if (request.method !== "POST") return send({ error: "不支持此操作" }, 405);
    const body = await readBody(request, action === 'import-reference-candidate' ? 7_000_000 : 2_000_000);
    if (action === 'import-reference-candidate')
      return send({ project: view(await importReferenceCandidate(service, id, {
        revision: Number(body.revision), shotId: String(body.shotId ?? ''),
        data: Buffer.from(String(body.base64 ?? ''), 'base64'), sha256: String(body.sha256 ?? ''),
        sourceLabel: String(body.sourceLabel ?? ''), ledger: String(body.ledger ?? ''),
      })) });
    if (action === 'bind-reference-candidate')
      return send({ project: view(await bindReferenceCandidate(service, id, String(body.runId), String(body.sha256 ?? ''),
        typeof body.shotId === 'string' ? body.shotId : undefined,
        typeof body.referenceOnly === 'boolean' ? body.referenceOnly : undefined)) });
    if (action === 'cleanup-rejected') return send({ project: view(await service.cleanupRejectedMedia(id)) });
    if (action === 'budgets')
      return send({ project: view(await service.configureBudgets(id, { credits: Number(body.credits), auxiliaryReserved: Number(body.auxiliaryReserved), cny: Number(body.cny) })) });
    if (action === 'billing-receipt')
      return send({ project: view(await service.recordBilling(id, body.receipt as Omit<BillingReceipt, 'recordedAt' | 'source'>)) });
    if (action === 'harness-policy')
      return send({ project: view(await service.configureHarness(id, body.policy as HarnessPolicy)) });
    if (action === 'reject-review')
      return send({ project: view(await service.rejectReview(id, String(body.runId), String(body.sha256 ?? ''), String(body.reason ?? ''))) });
    if (action === 'acknowledge-review')
      return send({ project: view(await service.acknowledgeReview(id, String(body.runId), String(body.sha256 ?? ''))) });
    const launch = (operation: () => Promise<unknown>) => {
      if (service.busy.has(id)) return send({ error: "当前任务正在执行" }, 409);
      void operation().catch(async (e) => {
        try {
          const p = await service.get(id);
          p.error = message(e);
          p.phase = "需要处理";
          await service.save(p);
        } catch {
          /* logged state cannot be updated */
        }
      });
      return send({ accepted: true }, 202);
    };
    if (action === "design") return launch(() => service.design(id));
    if (action === 'prepare-reference') return launch(() => service.prepareReference(id, String(body.characterId)));
    if (action === "propose")
      return launch(() => service.propose(id, String(body.command ?? "").slice(0, 6000)));
    if (action === "apply")
      return send({ project: view(await service.apply(id, body.story, Number(body.revision))) });
    if (action === "prepare")
      return launch(() =>
        service.prepare(
          id,
          String(body.shotId),
          body.provider as "seedance" | "dreamina",
          typeof body.model === "string" ? body.model : undefined,
        ),
      );
    if (action === "run")
      return launch(() =>
        service.run(
          id,
          String(body.runId),
          typeof body.creditCeiling === "number" ? body.creditCeiling : undefined,
          body.currencyQuote as { ceiling: number; evidence: string } | undefined,
        ),
      );
    if (action === "sync") return launch(() => service.sync(id));
    if (action === "approve")
      return send({ project: view(await service.approve(id, String(body.runId), String(body.sha256 ?? ''))) });
    if (action === "reference")
      return send({
        project: view(
          await service.reference(
            id,
            String(body.characterId),
            Buffer.from(String(body.base64), "base64"),
            String(body.mime),
          ),
        ),
      });
    if (action === "export") return launch(() => service.exportEpisode(id, String(body.episodeId)));
    if (action === "restore") {
      const version = Number(body.version);
      if (!Number.isInteger(version) || version < 1) throw new Error("无效版本");
      const { readFile } = await import("node:fs/promises");
      return send({
        project: view(
          await service.apply(
            id,
            JSON.parse(
              await readFile(
                path.join(service.directory(id), "versions", `${version}.json`),
                "utf8",
              ),
            ),
            Number(body.revision),
          ),
        ),
      });
    }
    return send({ error: "未知操作" }, 404);
  } catch (e) {
    return send({ error: message(e) }, 400);
  }
}
async function readBody(request: IncomingMessage, limit = 2_000_000): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of request) {
    size += c.length;
    if (size > limit) throw new Error("请求过大");
    chunks.push(Buffer.from(c));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
}
