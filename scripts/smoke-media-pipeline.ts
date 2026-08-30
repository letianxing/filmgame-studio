import { mkdir } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

import { MediaPipeline } from '../services/media-pipeline/src/index.js';

loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url)));

const ffmpegPath = process.env.FFMPEG_PATH;
const ffprobePath = process.env.FFPROBE_PATH;
if (!ffmpegPath || !ffprobePath) {
  throw new Error('FFMPEG_PATH and FFPROBE_PATH are required');
}

const outputDirectory = new URL('../artifacts/media-smoke/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });
const videoPath = fileURLToPath(new URL('test-pattern.mp4', outputDirectory));
const secondVideoPath = fileURLToPath(new URL('test-pattern-2.mp4', outputDirectory));
const thumbnailPath = fileURLToPath(new URL('thumbnail.jpg', outputDirectory));
const voicePath = fileURLToPath(new URL('voice.wav', outputDirectory));
const ambiencePath = fileURLToPath(new URL('ambience.wav', outputDirectory));
const mixedAudioPath = fileURLToPath(new URL('mixed.wav', outputDirectory));
const pipeline = new MediaPipeline({
  ffmpegPath,
  ffprobePath,
  defaultVideoCodec: 'libopenh264',
  defaultAudioCodec: 'aac',
  defaultTimeoutMs: 60_000,
});

const health = await pipeline.health();
if (health.status !== 'HEALTHY') throw new Error(health.message ?? 'Media pipeline unavailable');
await pipeline.createTestPattern({ outputPath: videoPath });
await pipeline.createTestPattern({ outputPath: secondVideoPath, durationSeconds: 1 });
await pipeline.normalizeAudio({ inputPath: videoPath, outputPath: voicePath });
await pipeline.normalizeAudio({ inputPath: secondVideoPath, outputPath: ambiencePath });
await pipeline.mixAudio({ inputPaths: [voicePath, ambiencePath], outputPath: mixedAudioPath });
await pipeline.thumbnail({ inputPath: videoPath, outputPath: thumbnailPath, atSeconds: 0.25 });
const probe = await pipeline.probe(videoPath);
const mixedProbe = await pipeline.probe(mixedAudioPath);

console.log(
  JSON.stringify({
    status: health.status,
    version: health.ffmpegVersion,
    video: videoPath,
    thumbnail: thumbnailPath,
    duration: probe.format?.duration,
    streams: probe.streams?.length ?? 0,
    mixedAudio: mixedAudioPath,
    mixedAudioStreams: mixedProbe.streams?.length ?? 0,
  }),
);
