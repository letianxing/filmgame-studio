import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

export interface MediaPipelineConfig {
  ffmpegPath: string;
  ffprobePath: string;
  defaultTimeoutMs?: number;
  defaultVideoCodec?: string;
  defaultAudioCodec?: string;
}

export interface MediaCommandResult {
  executable: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  startedAt: string;
  completedAt: string;
}

export interface MediaProbe {
  format?: {
    filename?: string;
    format_name?: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
  };
  streams?: Array<Record<string, unknown>>;
}

export interface MediaValidationPolicy {
  requireVideo?: boolean;
  requireAudio?: boolean;
  minimumWidth?: number;
  minimumHeight?: number;
  expectedAspectRatio?: number;
  aspectRatioTolerance?: number;
  minimumFps?: number;
  maximumFps?: number;
  minimumAudioSampleRate?: number;
  allowedVideoCodecs?: string[];
  expectedDurationSeconds?: number;
  durationToleranceSeconds?: number;
}

export interface MediaValidationIssue {
  code: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
}

export interface MediaTechnicalValidation {
  valid: boolean;
  issues: MediaValidationIssue[];
  video?: { codec: string; width: number; height: number; fps: number; aspectRatio: number };
  audio?: { codec: string; sampleRate: number; channels: number };
  durationSeconds?: number;
}

export interface MediaSignalAnalysis {
  blackSegments: number;
  silentSegments: number;
  issues: MediaValidationIssue[];
}

export class MediaPipeline {
  constructor(readonly config: MediaPipelineConfig) {
    if (!config.ffmpegPath || !config.ffprobePath) {
      throw new Error('FFMPEG_PATH and FFPROBE_PATH must be configured');
    }
  }

  async health(): Promise<{
    status: 'HEALTHY' | 'UNAVAILABLE';
    ffmpegVersion?: string;
    buildConfiguration?: string;
    message?: string;
  }> {
    try {
      await Promise.all([access(this.config.ffmpegPath), access(this.config.ffprobePath)]);
      const [version, build] = await Promise.all([
        this.#run(this.config.ffmpegPath, ['-hide_banner', '-version'], 10_000),
        this.#run(this.config.ffmpegPath, ['-hide_banner', '-buildconf'], 10_000),
      ]);
      return {
        status: 'HEALTHY',
        ffmpegVersion: version.stdout.split(/\r?\n/)[0] ?? '',
        buildConfiguration: build.stdout,
      };
    } catch (cause) {
      return {
        status: 'UNAVAILABLE',
        message: cause instanceof Error ? cause.message : 'FFmpeg is unavailable',
      };
    }
  }

  async probe(inputPath: string, signal?: AbortSignal): Promise<MediaProbe> {
    assertAbsolute(inputPath);
    const result = await this.#run(
      this.config.ffprobePath,
      ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', inputPath],
      this.config.defaultTimeoutMs,
      signal,
    );
    return JSON.parse(result.stdout) as MediaProbe;
  }

  async validateTechnical(
    inputPath: string,
    policy: MediaValidationPolicy = {},
    signal?: AbortSignal,
  ): Promise<MediaTechnicalValidation> {
    return validateMediaProbe(await this.probe(inputPath, signal), policy);
  }

  async analyzeSignals(inputPath: string, signal?: AbortSignal): Promise<MediaSignalAnalysis> {
    assertAbsolute(inputPath);
    const result = await this.#run(
      this.config.ffmpegPath,
      [
        '-hide_banner', '-nostdin', '-i', inputPath,
        '-vf', 'blackdetect=d=1:pix_th=0.10',
        '-af', 'silencedetect=n=-50dB:d=1',
        '-f', 'null', '-',
      ],
      this.config.defaultTimeoutMs,
      signal,
    );
    return parseMediaSignalLog(result.stderr);
  }

  /** Bound uploaded reference resolution before submitting inline bytes to a provider. */
  prepareReferenceImage(options: { inputPath: string; outputPath: string; signal?: AbortSignal }): Promise<MediaCommandResult> {
    assertPaths(options.inputPath, options.outputPath);
    return this.#run(this.config.ffmpegPath, ['-hide_banner', '-nostdin', '-y', '-i', options.inputPath,
      '-vf', 'scale=1024:1024:force_original_aspect_ratio=decrease', '-frames:v', '1', '-q:v', '3', options.outputPath],
      this.config.defaultTimeoutMs, options.signal);
  }

  /** Normalize a linear-drama shot, keeping dialogue intact and adding a soft subtitle track. */
  renderDramaShot(options: {
    visualPath: string; stillImage: boolean; audioPath?: string; subtitlePath?: string;
    outputPath: string; durationSeconds: number; width: number; height: number; signal?: AbortSignal;
  }): Promise<MediaCommandResult> {
    assertPaths(options.visualPath, options.outputPath, ...[options.audioPath, options.subtitlePath].filter((p): p is string => Boolean(p)));
    if (!Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0 || options.durationSeconds > 300) throw new Error('Invalid shot duration');
    if (![options.width, options.height].every((n) => Number.isInteger(n) && n >= 64 && n <= 4096 && n % 2 === 0)) throw new Error('Invalid shot dimensions');
    return this.#run(this.config.ffmpegPath, [
      '-hide_banner', '-nostdin', '-y',
      ...(options.stillImage ? ['-loop', '1', '-framerate', '30'] : []), '-i', options.visualPath,
      ...(options.audioPath ? ['-i', options.audioPath] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']),
      ...(options.subtitlePath ? ['-i', options.subtitlePath] : []),
      '-map', '0:v:0', '-map', '1:a:0', ...(options.subtitlePath ? ['-map', '2:0', '-c:s', 'mov_text'] : []),
      '-vf', `scale=${options.width}:${options.height}:force_original_aspect_ratio=decrease,pad=${options.width}:${options.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=${options.durationSeconds}`,
      '-af', 'apad', '-t', String(options.durationSeconds), '-c:v', this.config.defaultVideoCodec ?? 'libopenh264',
      '-pix_fmt', 'yuv420p', '-b:v', '4000k', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', options.outputPath,
    ], this.config.defaultTimeoutMs, options.signal);
  }

  attachDramaSubtitles(options: { inputPath: string; subtitlePath: string; outputPath: string; signal?: AbortSignal }): Promise<MediaCommandResult> {
    assertPaths(options.inputPath, options.subtitlePath, options.outputPath);
    return this.#run(this.config.ffmpegPath, ['-hide_banner', '-nostdin', '-y', '-i', options.inputPath,
      '-i', options.subtitlePath, '-map', '0:v:0', '-map', '0:a:0', '-map', '1:0', '-c:v', 'copy', '-c:a', 'copy',
      '-c:s', 'mov_text', '-metadata:s:s:0', 'language=zho', '-movflags', '+faststart', options.outputPath],
      this.config.defaultTimeoutMs, options.signal);
  }

  mixDramaMusic(options: { inputPath: string; musicPath: string; outputPath: string; signal?: AbortSignal }): Promise<MediaCommandResult> {
    assertPaths(options.inputPath, options.musicPath, options.outputPath);
    return this.#run(this.config.ffmpegPath, ['-hide_banner', '-nostdin', '-y', '-i', options.inputPath,
      '-stream_loop', '-1', '-i', options.musicPath, '-filter_complex',
      '[1:a]volume=0.15[bgm];[0:a][bgm]amix=inputs=2:duration=first:normalize=0[a]',
      '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-ac', '2',
      '-movflags', '+faststart', options.outputPath], this.config.defaultTimeoutMs, options.signal);
  }

  transcode(options: {
    inputPath: string;
    outputPath: string;
    videoCodec?: string;
    audioCodec?: string;
    videoBitrate?: string;
    audioBitrate?: string;
    signal?: AbortSignal;
  }): Promise<MediaCommandResult> {
    assertPaths(options.inputPath, options.outputPath);
    return this.#run(
      this.config.ffmpegPath,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-i',
        options.inputPath,
        '-c:v',
        options.videoCodec ?? this.config.defaultVideoCodec ?? 'libopenh264',
        '-c:a',
        options.audioCodec ?? this.config.defaultAudioCodec ?? 'aac',
        ...(options.videoBitrate ? ['-b:v', options.videoBitrate] : []),
        ...(options.audioBitrate ? ['-b:a', options.audioBitrate] : []),
        options.outputPath,
      ],
      this.config.defaultTimeoutMs,
      options.signal,
    );
  }

  mux(options: {
    videoPath: string;
    audioPath: string;
    outputPath: string;
    signal?: AbortSignal;
  }): Promise<MediaCommandResult> {
    assertPaths(options.videoPath, options.audioPath, options.outputPath);
    return this.#run(
      this.config.ffmpegPath,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-i',
        options.videoPath,
        '-i',
        options.audioPath,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-shortest',
        options.outputPath,
      ],
      this.config.defaultTimeoutMs,
      options.signal,
    );
  }

  normalizeAudio(options: {
    inputPath: string;
    outputPath: string;
    targetLufs?: number;
    signal?: AbortSignal;
  }): Promise<MediaCommandResult> {
    assertPaths(options.inputPath, options.outputPath);
    const target = options.targetLufs ?? -16;
    return this.#run(
      this.config.ffmpegPath,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-i',
        options.inputPath,
        '-af',
        `loudnorm=I=${target}:TP=-1.5:LRA=11`,
        options.outputPath,
      ],
      this.config.defaultTimeoutMs,
      options.signal,
    );
  }

  mixAudio(options: {
    inputPaths: string[];
    outputPath: string;
    signal?: AbortSignal;
  }): Promise<MediaCommandResult> {
    if (!options.inputPaths.length) throw new Error('mixAudio requires at least one input');
    assertPaths(...options.inputPaths, options.outputPath);
    return this.#run(
      this.config.ffmpegPath,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        ...options.inputPaths.flatMap((inputPath) => ['-i', inputPath]),
        '-filter_complex',
        `amix=inputs=${options.inputPaths.length}:duration=longest:dropout_transition=0:normalize=0`,
        '-c:a',
        'pcm_s16le',
        options.outputPath,
      ],
      this.config.defaultTimeoutMs,
      options.signal,
    );
  }

  burnSubtitles(options: {
    inputPath: string;
    subtitlePath: string;
    outputPath: string;
    signal?: AbortSignal;
  }): Promise<MediaCommandResult> {
    assertPaths(options.inputPath, options.subtitlePath, options.outputPath);
    return this.#run(
      this.config.ffmpegPath,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-i',
        options.inputPath,
        '-vf',
        `subtitles='${escapeFilterPath(options.subtitlePath)}'`,
        '-c:a',
        'copy',
        options.outputPath,
      ],
      this.config.defaultTimeoutMs,
      options.signal,
    );
  }

  thumbnail(options: {
    inputPath: string;
    outputPath: string;
    atSeconds?: number;
    width?: number;
    signal?: AbortSignal;
  }): Promise<MediaCommandResult> {
    assertPaths(options.inputPath, options.outputPath);
    return this.#run(
      this.config.ffmpegPath,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-ss',
        String(options.atSeconds ?? 1),
        '-i',
        options.inputPath,
        '-frames:v',
        '1',
        '-vf',
        `scale=${options.width ?? 640}:-2`,
        options.outputPath,
      ],
      this.config.defaultTimeoutMs,
      options.signal,
    );
  }

  concat(options: {
    concatListPath: string;
    outputPath: string;
    reencode?: boolean;
    signal?: AbortSignal;
  }): Promise<MediaCommandResult> {
    assertPaths(options.concatListPath, options.outputPath);
    return this.#run(
      this.config.ffmpegPath,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-f',
        'concat',
        '-safe',
        '1',
        '-i',
        options.concatListPath,
        ...(options.reencode
          ? [
              '-c:v',
              this.config.defaultVideoCodec ?? 'libopenh264',
              '-c:a',
              this.config.defaultAudioCodec ?? 'aac',
            ]
          : ['-c', 'copy']),
        options.outputPath,
      ],
      this.config.defaultTimeoutMs,
      options.signal,
    );
  }

  createTestPattern(options: {
    outputPath: string;
    durationSeconds?: number;
    width?: number;
    height?: number;
    signal?: AbortSignal;
  }): Promise<MediaCommandResult> {
    assertAbsolute(options.outputPath);
    const duration = options.durationSeconds ?? 1;
    const width = options.width ?? 640;
    const height = options.height ?? 360;
    return this.#run(
      this.config.ffmpegPath,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=0x101820:s=${width}x${height}:r=24:d=${duration}`,
        '-f',
        'lavfi',
        '-i',
        `anullsrc=r=48000:cl=stereo:d=${duration}`,
        '-shortest',
        '-c:v',
        this.config.defaultVideoCodec ?? 'libopenh264',
        '-b:v',
        '1200k',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        this.config.defaultAudioCodec ?? 'aac',
        options.outputPath,
      ],
      this.config.defaultTimeoutMs,
      options.signal,
    );
  }

  #run(
    executable: string,
    args: string[],
    timeoutMs = 30 * 60_000,
    signal?: AbortSignal,
  ): Promise<MediaCommandResult> {
    return new Promise((resolve, reject) => {
      const startedAt = new Date().toISOString();
      const child = spawn(executable, args, {
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`Media command timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const abort = (): void => {
        child.kill();
        reject(signal?.reason ?? new Error('Media command aborted'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
      child.once('error', (error) => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        reject(error);
      });
      child.once('close', (exitCode) => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        const result: MediaCommandResult = {
          executable,
          args: [...args],
          exitCode: exitCode ?? -1,
          stdout,
          stderr,
          startedAt,
          completedAt: new Date().toISOString(),
        };
        if (exitCode === 0) resolve(result);
        else reject(new MediaPipelineError(result));
      });
    });
  }
}

export function validateMediaProbe(
  probe: MediaProbe,
  policy: MediaValidationPolicy = {},
): MediaTechnicalValidation {
  const issues: MediaValidationIssue[] = [];
  const streams = probe.streams ?? [];
  const videoStream = streams.find((stream) => stream.codec_type === 'video');
  const audioStream = streams.find((stream) => stream.codec_type === 'audio');
  const requireVideo = policy.requireVideo ?? true;
  const requireAudio = policy.requireAudio ?? true;
  if (requireVideo && !videoStream) issues.push(mediaIssue('MISSING_VIDEO', 'ERROR', 'No video stream found.'));
  if (requireAudio && !audioStream) issues.push(mediaIssue('MISSING_AUDIO', 'ERROR', 'No audio stream found.'));
  let video: MediaTechnicalValidation['video'];
  if (videoStream) {
    const codec = String(videoStream.codec_name ?? 'unknown');
    const width = Number(videoStream.width ?? 0);
    const height = Number(videoStream.height ?? 0);
    const fps = parseFrameRate(String(videoStream.avg_frame_rate ?? videoStream.r_frame_rate ?? '0/1'));
    const aspectRatio = height > 0 ? width / height : 0;
    if (width < (policy.minimumWidth ?? 320) || height < (policy.minimumHeight ?? 180)) {
      issues.push(mediaIssue('RESOLUTION_TOO_LOW', 'ERROR', `Resolution ${width}x${height} is below policy.`));
    }
    if (fps < (policy.minimumFps ?? 1) || fps > (policy.maximumFps ?? 120)) {
      issues.push(mediaIssue('FPS_OUT_OF_RANGE', 'ERROR', `FPS ${fps} is outside policy.`));
    }
    if (policy.allowedVideoCodecs?.length && !policy.allowedVideoCodecs.includes(codec)) {
      issues.push(mediaIssue('VIDEO_CODEC_UNSUPPORTED', 'ERROR', `Video codec ${codec} is not allowed.`));
    }
    if (
      policy.expectedAspectRatio &&
      Math.abs(aspectRatio - policy.expectedAspectRatio) > (policy.aspectRatioTolerance ?? 0.03)
    ) {
      issues.push(mediaIssue('ASPECT_RATIO_MISMATCH', 'ERROR', `Aspect ratio ${aspectRatio.toFixed(3)} does not match ${policy.expectedAspectRatio.toFixed(3)}.`));
    }
    video = { codec, width, height, fps, aspectRatio };
  }
  let audio: MediaTechnicalValidation['audio'];
  if (audioStream) {
    const codec = String(audioStream.codec_name ?? 'unknown');
    const sampleRate = Number(audioStream.sample_rate ?? 0);
    const channels = Number(audioStream.channels ?? 0);
    if (sampleRate < (policy.minimumAudioSampleRate ?? 16_000)) {
      issues.push(mediaIssue('AUDIO_SAMPLE_RATE_TOO_LOW', 'ERROR', `Audio sample rate ${sampleRate} is below policy.`));
    }
    if (!Number.isInteger(channels) || channels < 1) {
      issues.push(mediaIssue('AUDIO_CHANNELS_INVALID', 'ERROR', 'Audio channel count is invalid.'));
    }
    audio = { codec, sampleRate, channels };
  }
  const durationSeconds = Number(probe.format?.duration ?? 0);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    issues.push(mediaIssue('DURATION_INVALID', 'ERROR', 'Media duration is missing or invalid.'));
  } else if (
    policy.expectedDurationSeconds !== undefined &&
    Math.abs(durationSeconds - policy.expectedDurationSeconds) > (policy.durationToleranceSeconds ?? 1)
  ) {
    issues.push(mediaIssue('DURATION_MISMATCH', 'ERROR', `Duration ${durationSeconds}s does not match expected ${policy.expectedDurationSeconds}s.`));
  }
  return {
    valid: !issues.some((issue) => issue.severity === 'ERROR'),
    issues,
    ...(video ? { video } : {}),
    ...(audio ? { audio } : {}),
    ...(durationSeconds > 0 ? { durationSeconds } : {}),
  };
}

export function parseMediaSignalLog(stderr: string): MediaSignalAnalysis {
  const blackSegments = (stderr.match(/black_start:/gu) ?? []).length;
  const silentSegments = (stderr.match(/silence_start:/gu) ?? []).length;
  const issues: MediaValidationIssue[] = [];
  if (blackSegments) issues.push(mediaIssue('BLACK_FRAME_SEGMENT', 'WARNING', `${blackSegments} black segment(s) detected.`));
  if (silentSegments) issues.push(mediaIssue('SILENT_AUDIO_SEGMENT', 'WARNING', `${silentSegments} silent segment(s) detected.`));
  return { blackSegments, silentSegments, issues };
}

function parseFrameRate(value: string): number {
  const [numerator, denominator] = value.split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator! / denominator!;
}

function mediaIssue(code: string, severity: MediaValidationIssue['severity'], message: string): MediaValidationIssue {
  return { code, severity, message };
}

export class MediaPipelineError extends Error {
  constructor(readonly result: MediaCommandResult) {
    super(`Media command failed with exit code ${result.exitCode}: ${result.stderr.slice(-1200)}`);
    this.name = 'MediaPipelineError';
  }
}

function assertPaths(...paths: string[]): void {
  for (const candidate of paths) assertAbsolute(candidate);
}

function assertAbsolute(candidate: string): void {
  if (!path.isAbsolute(candidate)) throw new Error(`Media path must be absolute: ${candidate}`);
}

function escapeFilterPath(candidate: string): string {
  return candidate.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}
