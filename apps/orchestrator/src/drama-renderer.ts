import { pathToFileURL } from 'node:url';
import { assertWanShots } from './drama-video-routing.js';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ImageProvider, VideoProvider, TTSProvider, MusicProvider, ProviderResult, GeneratedAsset, ProviderContext } from '@filmgame/provider-sdk';
import type { DramaDocument } from '@filmgame/shared-types';
import { dramaShotInputs, dramaVoiceBlockers } from '@filmgame/story-engine';
import type { MediaPipeline } from '@filmgame/media-pipeline';
import { DramaStore, type DramaRecord, type DramaRender } from './drama-store.js';

export interface DramaRenderServices {
  image: ImageProvider; video?: VideoProvider; tts: TTSProvider; media: MediaPipeline;
  music?: MusicProvider;
  /** Includes provider model/workflow settings so a provider change invalidates cached shots. */
  fingerprint: string;
}

export async function renderDrama(record: DramaRecord, run: DramaRender, store: DramaStore,
  services: DramaRenderServices, signal: AbortSignal): Promise<void> {
  const doc = structuredClone(record.document!);
  if (run.videoBackend === 'WAN') assertWanShots(doc);
  const blockers = dramaVoiceBlockers(doc);
  if (blockers.length) throw new Error(blockers.join('；'));
  if (run.mode === 'VIDEO' && !services.video) throw new Error('请配置 VideoProvider，或选择分镜预演');
  if (run.musicPrompt && !services.music) throw new Error('请配置 MusicProvider，或清空配乐要求');
  const work = path.join(store.root, 'work', record.id, run.id);
  await mkdir(work, { recursive: true });
  const [width, height] = doc.aspectRatio === '9:16' ? [720, 1280] : [1280, 720];
  const context = (key: string): ProviderContext => ({ projectId: record.id, storyVersion: doc.version,
    requestId: `${run.id}:${key}`, idempotencyKey: `${record.id}:${key}`, signal });
  const persist = async (file: string, mimeType: string): Promise<string> => {
    const asset = await store.put(createReadStream(file), mimeType); record.assets[asset.id] = asset; return asset.id;
  };
  const importResult = async (result: ProviderResult<GeneratedAsset>, inputHash: string) => {
    const asset = await store.importGenerated(result.data.temporaryUri, result.data.mimeType, signal);
    record.assets[asset.id] = asset;
    (record.generations ??= []).push({ assetId: asset.id, provider: result.provider,
      ...(result.model ? { model: result.model } : {}), requestId: result.requestId, inputHash,
      createdAt: result.completedAt, usage: result.usage ?? [] });
    await store.save(record);
    return asset;
  };
  for (const episode of doc.episodes) {
    const episodeCues: Cue[] = []; let offset = 0; const files: string[] = [];
    for (const shot of episode.shots) {
      signal.throwIfAborted();
      const hash = createHash('sha256').update(JSON.stringify({ input: dramaShotInputs(doc, shot.id), mode: run.mode,
        providers: services.fingerprint, videoBackend: run.videoBackend, renderer: 2 })).digest('hex');
      const cached = record.renders.filter((r) => r.id !== run.id).flatMap((r) => Object.values(r.shots)).find((s) => s.hash === hash);
      const output = path.join(work, `${shot.id}.mp4`);
      let cues: Cue[] = [];
      if (cached && await store.assetExists(record, cached.video) && await store.assetExists(record, cached.subtitle)) {
        await copyFile(store.assetPath(cached.video), output);
        const { readFile } = await import('node:fs/promises');
        cues = JSON.parse(await readFile(store.assetPath(cached.subtitle), 'utf8')) as Cue[];
        run.shots[shot.id] = { ...cached };
      } else {
        run.message = `制作镜头 ${shot.id}：${shot.description.slice(0, 70)}`; await store.save(record);
        const characters = doc.characters.filter((c) => shot.characterIds.includes(c.id));
        const prompt = [doc.visualStyle, shot.description, shot.camera,
          ...characters.map((c) => `${c.name}: ${c.appearance}`), 'No text overlays, no subtitles.'].join('\n');
        let visual: string;
        if (run.mode === 'VIDEO') {
          const localWan = run.videoBackend === 'WAN';
          const referenceAssetUris: string[] = [];
          // Reference preparation is serial to avoid concurrent FFmpeg processes.
          if (!localWan) for (const c of characters.filter((c) => c.referenceImageAssetId)) {
            const image = path.join(work, `reference-${c.id}.jpg`);
            await services.media.prepareReferenceImage({ inputPath: store.assetPath(c.referenceImageAssetId), outputPath: image, signal });
            const bytes = await readFile(image);
            if (bytes.length > 1024 * 1024) throw new Error(`${c.name} 的参考图超过 1 MB`);
            referenceAssetUris.push(`data:image/jpeg;base64,${bytes.toString('base64')}`);
          }
          let firstFrameUri: string | undefined;
          if (shot.firstFrameAssetId) {
            const frame = path.join(work, `first-frame-${shot.id}.jpg`);
            await services.media.prepareReferenceImage({ inputPath: store.assetPath(shot.firstFrameAssetId!), outputPath: frame, signal });
            if (localWan) firstFrameUri = pathToFileURL(frame).href;
            else {
              const bytes = await readFile(frame);
              if (bytes.length > 1024 * 1024) throw new Error('镜头首帧超过1MB');
              firstFrameUri = `data:image/jpeg;base64,${bytes.toString('base64')}`;
            }
          }
          const generated = await services.video!.generateVideo({ prompt: `${prompt}\nFrame aspect ratio ${doc.aspectRatio}.`,
            durationSeconds: localWan ? shot.durationSeconds : Math.max(4, shot.durationSeconds), aspectRatio: doc.aspectRatio,
            generateAudio: false, referenceAssetUris,
            ...(firstFrameUri ? { firstFrameUri } : {}),
            ...(localWan ? { workflowId: 'wan2-2-ti2v-5b-v1' } : {}),
          }, context(`${hash}:video`));
          const asset = await importResult(generated, hash);
          record.assets[asset.id] = asset; visual = store.assetPath(asset.id);
        } else {
          // FLUX Schnell is text-only. Reference images are deliberately not claimed as conditioning here.
          const generated = await services.image.generateImage({ prompt, width: Math.round(width / 2 / 16) * 16,
            height: Math.round(height / 2 / 16) * 16, referenceAssetUris: [], workflowId: 'flux-schnell-fp8-v1',
            seed: parseInt(hash.slice(0, 8), 16) }, context(`${hash}:image`));
          const asset = await importResult(generated, hash);
          record.assets[asset.id] = asset; visual = store.assetPath(asset.id);
        }
        const voiceFiles: string[] = []; let voiceTime = 0;
        for (const [index, line] of shot.dialogue.entries()) {
          const character = characters.find((c) => c.id === line.characterId)!;
          const voice = await services.tts.synthesize({ text: line.text, language: 'zh-CN', style: '', emotion: '', speed: 1,
            outputFormat: 'WAV', ...(character.voiceReferenceAssetId ? {
              referenceAudioUri: await store.dataUri(record, character.voiceReferenceAssetId), referenceTranscript: character.referenceTranscript,
            } : { voiceId: character.voiceId }) }, context(`${hash}:voice:${index}`));
          const asset = await importResult(voice, `${hash}:voice:${index}`);
          const voicePath = path.join(work, `${shot.id}-voice-${index}.wav`);
          await services.media.normalizeAudio({ inputPath: store.assetPath(asset.id), outputPath: voicePath, signal });
          const seconds = Number((await services.media.probe(voicePath, signal)).format?.duration);
          if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 120) throw new Error('配音时长无效');
          cues.push({ start: voiceTime, end: voiceTime + seconds, text: `${character.name}：${line.text}` });
          voiceTime += seconds; voiceFiles.push(voicePath);
        }
        let audioPath: string | undefined;
        if (voiceFiles.length) {
          audioPath = voiceFiles[0]!;
          if (voiceFiles.length > 1) {
            const list = path.join(work, `${shot.id}-voices.txt`);
            await writeFile(list, voiceFiles.map((f) => `file '${path.basename(f)}'`).join('\n'));
            audioPath = path.join(work, `${shot.id}-voices.wav`);
            await services.media.concat({ concatListPath: list, outputPath: audioPath, signal });
          }
        }
        // Never truncate a spoken line: extend the final visual frame to fit the generated dialogue.
        const duration = Math.ceil(Math.max(shot.durationSeconds, voiceTime + 0.2) * 30) / 30;
        await services.media.renderDramaShot({ visualPath: visual, stillImage: run.mode === 'STORYBOARD',
          ...(audioPath ? { audioPath } : {}), outputPath: output, durationSeconds: duration, width, height, signal });
        const qa = await services.media.validateTechnical(output, { requireVideo: true, requireAudio: true,
          minimumWidth: width, minimumHeight: height, expectedDurationSeconds: duration, durationToleranceSeconds: 0.3 }, signal);
        if (!qa.valid) throw new Error(`镜头技术检查未通过：${JSON.stringify(qa.issues)}`);
        const subtitle = await store.put(Buffer.from(JSON.stringify(cues)), 'application/json'); record.assets[subtitle.id] = subtitle;
        run.shots[shot.id] = { hash, video: await persist(output, 'video/mp4'), subtitle: subtitle.id,
          duration: qa.durationSeconds ?? duration };
      }
      const completed = run.shots[shot.id]!;
      files.push(output);
      episodeCues.push(...cues.map((c) => ({ ...c, start: c.start + offset, end: c.end + offset })));
      offset += completed.duration; run.completed++; await store.save(record);
    }
    signal.throwIfAborted();
    run.message = `合成 ${episode.title}`; await store.save(record);
    const list = path.join(work, `${episode.id}.txt`);
    await writeFile(list, files.map((file) => `file '${path.basename(file)}'`).join('\n'));
    const assembled = path.join(work, `${episode.id}-assembled.mp4`);
    await services.media.concat({ concatListPath: list, outputPath: assembled, signal });
    let finalPath = assembled;
    if (run.musicPrompt && services.music) {
      const music = await services.music.generateMusic({ prompt: run.musicPrompt, durationSeconds: Math.ceil(offset), seamlessLoop: false },
        context(`${run.id}:${episode.id}:music`));
      const asset = await importResult(music, createHash('sha256').update(`${episode.id}:${offset}:${run.musicPrompt}`).digest('hex'));
      finalPath = path.join(work, `${episode.id}-music.mp4`);
      await services.media.mixDramaMusic({ inputPath: assembled, musicPath: store.assetPath(asset.id), outputPath: finalPath, signal });
    }
    if (episodeCues.length) {
      const srt = path.join(work, `${episode.id}.srt`); await writeFile(srt, formatSubtitles(episodeCues, false));
      const inputPath = finalPath; finalPath = path.join(work, `${episode.id}.mp4`);
      await services.media.attachDramaSubtitles({ inputPath, subtitlePath: srt, outputPath: finalPath, signal });
    }
    const qa = await services.media.validateTechnical(finalPath, { requireVideo: true, requireAudio: true,
      expectedDurationSeconds: offset, durationToleranceSeconds: 1 }, signal);
    if (!qa.valid) throw new Error(`整集技术检查未通过：${JSON.stringify(qa.issues)}`);
    const subtitle = await store.put(Buffer.from(formatSubtitles(episodeCues, true)), 'text/vtt'); record.assets[subtitle.id] = subtitle;
    run.episodes.push({ id: episode.id, title: episode.title, video: await persist(finalPath, 'video/mp4'),
      subtitle: subtitle.id, duration: qa.durationSeconds ?? offset });
    await store.save(record);
  }
  run.status = 'COMPLETED'; run.message = '整集制作完成，请预览并检查角色一致性、字幕和声音'; await store.save(record);
}

export interface Cue { start: number; end: number; text: string }
export function formatSubtitles(cues: Cue[], vtt: boolean): string {
  const time = (seconds: number) => {
    const ms = Math.round(seconds * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${vtt ? '.' : ','}${String(ms % 1000).padStart(3, '0')}`;
  };
  return (vtt ? 'WEBVTT\n\n' : '') + cues.map((cue, i) => `${i + 1}\n${time(cue.start)} --> ${time(cue.end)}\n${cue.text.replace(/[<>]/g, '').replace(/[\r\n]+/g, ' ')}\n`).join('\n');
}
