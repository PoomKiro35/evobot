// utils/config.ts
import "dotenv/config";
import { Config } from "../interfaces/Config";

let fileCfg: Partial<Config> = {};
try {
  fileCfg = require("../config.json");
} catch {
  fileCfg = {};
}

export const config: Config = {
  TOKEN: process.env.TOKEN ?? fileCfg.TOKEN ?? "",
  MAX_PLAYLIST_SIZE:
    (process.env.MAX_PLAYLIST_SIZE && parseInt(process.env.MAX_PLAYLIST_SIZE)) ||
    fileCfg.MAX_PLAYLIST_SIZE ||
    10,
  PRUNING:
    process.env.PRUNING !== undefined
      ? process.env.PRUNING === "true"
      : fileCfg.PRUNING ?? false,
  STAY_TIME:
    (process.env.STAY_TIME && parseInt(process.env.STAY_TIME)) ||
    fileCfg.STAY_TIME ||
    30,
  DEFAULT_VOLUME:
    (process.env.DEFAULT_VOLUME && parseInt(process.env.DEFAULT_VOLUME)) ||
    fileCfg.DEFAULT_VOLUME ||
    100,
  LOCALE: process.env.LOCALE ?? fileCfg.LOCALE ?? "en"
};
