// utils/ytdlp.ts
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { createAudioResource, StreamType, AudioResource } from "@discordjs/voice";

export type YTDLPProcesses = {
  ytdlp: ChildProcessWithoutNullStreams;
  ffmpeg: ChildProcessWithoutNullStreams;
};

/**
 * Create a Discord audio resource by piping yt-dlp -> ffmpeg -> @discordjs/voice
 * - url: YouTube (or many other) URLs supported by yt-dlp
 */
export function createYTDLPResource(url: string): { resource: AudioResource; procs: YTDLPProcesses } {
  // 1) yt-dlp: fetch best audio to stdout
  const ytdlp = spawn("yt-dlp", ["-f", "bestaudio", "-o", "-", url], {
    stdio: ["ignore", "pipe", "inherit"]
  });

  // 2) ffmpeg: transcode to 48kHz stereo PCM raw
  const ffmpeg = spawn("ffmpeg", [
    "-loglevel", "error",
    "-i", "pipe:0",
    "-f", "s16le",
    "-ar", "48000",
    "-ac", "2",
    "pipe:1"
  ], {
    stdio: ["pipe", "pipe", "inherit"]
  });

  // Pipe yt-dlp output -> ffmpeg input
  ytdlp.stdout.pipe(ffmpeg.stdin);

  // 3) Hand ffmpeg stdout to discord voice as a raw stream
  const resource = createAudioResource(ffmpeg.stdout, {
    inputType: StreamType.Raw,
    inlineVolume: false
  });

  // Basic cleanup if either process exits early
  const killBoth = () => {
    try { ytdlp.kill("SIGKILL"); } catch {}
    try { ffmpeg.kill("SIGKILL"); } catch {}
  };

  ytdlp.on("close", (code) => {
    if (code !== 0) {
      console.error(`yt-dlp exited with code ${code}`);
      killBoth();
    }
  });
  ffmpeg.on("close", (code) => {
    if (code !== 0) {
      console.error(`ffmpeg exited with code ${code}`);
      killBoth();
    }
  });

  return { resource, procs: { ytdlp, ffmpeg } };
}

/** Call this when you stop/skip/destroy the player to avoid orphaned processes. */
export function stopYTDLP(procs?: YTDLPProcesses) {
  if (!procs) return;
  try { procs.ytdlp.kill("SIGKILL"); } catch {}
  try { procs.ffmpeg.kill("SIGKILL"); } catch {}
}
