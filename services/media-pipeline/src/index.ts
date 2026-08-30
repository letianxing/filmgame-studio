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
