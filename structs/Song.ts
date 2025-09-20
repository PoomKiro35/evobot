// structs/Song.ts
import { AudioResource, createAudioResource, StreamType } from "@discordjs/voice";
import youtube from "youtube-sr";
import { i18n } from "../utils/i18n";
import { videoPattern, isURL } from "../utils/patterns";
import { spawn, ChildProcess } from "node:child_process";
import { join } from "node:path";

export interface SongData {
  url: string;
  title: string;
  duration: number;
}

export class Song {
  public readonly url: string;
  public readonly title: string;
  public readonly duration: number;

  // hold spawned processes so we can kill them on stop/skip
  private procs?: { ytdlp: ChildProcess; ffmpeg: ChildProcess };

  // resolve binary paths
  private static readonly YTDLP_PATH =
    process.env.YTDLP_PATH || join(process.cwd(), "bin", "yt-dlp");
  private static readonly FFMPEG_PATH =
    process.env.FFMPEG_PATH || "ffmpeg"; // provided by apt.txt

  public constructor({ url, title, duration }: SongData) {
    this.url = url;
    this.title = title;
    this.duration = duration;
  }

  public static async from(url: string = "", search: string = "") {
    const isYoutubeUrl = videoPattern.test(url);

    let finalUrl = "";
    let title = "";
    let durationSec = 0;

    if (isYoutubeUrl) {
      // Use youtube-sr for lightweight metadata (no play-dl)
      const info = await youtube.getVideo(url);

      finalUrl = info?.url ?? url; // fallback to original url
      title = info?.title ?? "Unknown title";
      // youtube-sr duration is number (ms) or undefined
      const durMs = typeof info?.duration === "number" ? info.duration : 0;
      durationSec = Math.round(durMs / 1000);
    } else {
      const result = await youtube.searchOne(search);

      if (!result) {
        const err = new Error(`No search results found for ${search}`);
        err.name = isURL.test(url) ? "InvalidURL" : "NoResults";
        throw err;
      }

      finalUrl = `https://youtube.com/watch?v=${result.id}`;
      title = result.title ?? "Unknown title";
      const durMs = typeof result.duration === "number" ? result.duration : 0;
      durationSec = Math.round(durMs / 1000);
    }

    return new this({
      url: finalUrl,
      title,
      duration: durationSec
    });
  }

  /**
   * Spawn yt-dlp -> ffmpeg and return a Discord AudioResource
   */
  public async makeResource(): Promise<AudioResource<Song>> {
    // 1) yt-dlp: fetch best audio to stdout
    const ytdlp = spawn(Song.YTDLP_PATH, ["-f", "bestaudio", "-o", "-", this.url], {
      stdio: ["ignore", "pipe", "inherit"]
    });

    // 2) ffmpeg: transcode to 48kHz stereo PCM from stdin, write raw PCM to stdout
    const ffmpeg = spawn(Song.FFMPEG_PATH, [
      "-loglevel", "error",
      "-i", "pipe:0",
      "-f", "s16le",
      "-ar", "48000",
      "-ac", "2",
      "pipe:1"
    ], { stdio: ["pipe", "pipe", "inherit"] });

    // Pipe yt-dlp output -> ffmpeg input
    if (ytdlp.stdout && ffmpeg.stdin) {
      ytdlp.stdout.pipe(ffmpeg.stdin);
    } else {
      throw new Error("Failed to connect yt-dlp to ffmpeg (no stdout/stdin).");
    }

    // Save processes to clean up later
    this.procs = { ytdlp, ffmpeg };

    if (!ffmpeg.stdout) {
      throw new Error("ffmpeg did not expose stdout");
    }

    return createAudioResource(ffmpeg.stdout, {
      metadata: this,
      inputType: StreamType.Raw,
      inlineVolume: true
    });
  }

  /**
   * Kill yt-dlp/ffmpeg if playback stops or is skipped
   */
  public stopProcesses() {
    if (!this.procs) return;
    try { this.procs.ytdlp.kill("SIGKILL"); } catch {}
    try { this.procs.ffmpeg.kill("SIGKILL"); } catch {}
    this.procs = undefined;
  }

  public startMessage() {
    return i18n.__mf("play.startedPlaying", { title: this.title, url: this.url });
  }
}
