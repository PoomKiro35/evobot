import { AudioResource, createAudioResource, StreamType } from "@discordjs/voice";
import youtube from "youtube-sr";
import { i18n } from "../utils/i18n";
import { videoPattern, isURL } from "../utils/patterns";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";

export interface SongData {
  url: string;
  title: string;
  duration: number;
}

export class Song {
  public readonly url: string;
  public readonly title: string;
  public readonly duration: number;

  // we’ll hold the spawned processes so we can kill them on stop/skip
  private procs?: { ytdlp: ChildProcessWithoutNullStreams; ffmpeg: ChildProcessWithoutNullStreams };

  public constructor({ url, title, duration }: SongData) {
    this.url = url;
    this.title = title;
    this.duration = duration;
  }

  public static async from(url: string = "", search: string = "") {
    const isYoutubeUrl = videoPattern.test(url);
    let finalUrl = url;
    let title = "";
    let duration = 0;

    if (isYoutubeUrl) {
      // Use youtube-sr just for quick metadata so we don’t hit play-dl
      const info = await youtube.getVideo(url);
      finalUrl = info.url;
      title = info.title;
      duration = info.duration / 1000; // youtube-sr gives ms
    } else {
      const result = await youtube.searchOne(search);
      if (!result) {
        const err = new Error(`No search results found for ${search}`);
        err.name = isURL.test(url) ? "InvalidURL" : "NoResults";
        throw err;
      }
      finalUrl = `https://youtube.com/watch?v=${result.id}`;
      title = result.title;
      duration = result.duration / 1000;
    }

    return new this({
      url: finalUrl,
      title,
      duration: Math.round(duration)
    });
  }

  /**
   * Spawn yt-dlp -> ffmpeg and return a Discord AudioResource
   */
  public async makeResource(): Promise<AudioResource<Song>> {
    // 1) spawn yt-dlp to fetch best audio
    const ytdlp = spawn("yt-dlp", ["-f", "bestaudio", "-o", "-", this.url], {
      stdio: ["ignore", "pipe", "inherit"]
    });

    // 2) spawn ffmpeg to convert to 48kHz stereo PCM
    const ffmpeg = spawn("ffmpeg", [
      "-loglevel", "error",
      "-i", "pipe:0",
      "-f", "s16le",
      "-ar", "48000",
      "-ac", "2",
      "pipe:1"
    ], { stdio: ["pipe", "pipe", "inherit"] });

    // Pipe yt-dlp output into ffmpeg input
    ytdlp.stdout.pipe(ffmpeg.stdin);

    // Save processes so we can clean up later
    this.procs = { ytdlp, ffmpeg };

    // 3) create Discord resource from ffmpeg stdout
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
