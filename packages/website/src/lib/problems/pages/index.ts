import type { ProblemPage } from "../types";
import { AUDIO_PAGES } from "./audio";
import { DOCUMENT_PAGES } from "./documents";
import { GAME_MOD_PAGES } from "./game-mods";
import { LOCAL_AI_PAGES } from "./local-ai";
import { PC_CLEANUP_PAGES } from "./pc-cleanup";
import { PDF_EXCEL_PAGES } from "./pdf-excel";
import { PHOTOS_FILES_PAGES } from "./photos-files";
import { VIDEO_PAGES } from "./video";

/** Every problem page, drafts included, one file per niche. A new niche's file goes here. */
export const ALL_PROBLEM_PAGES: ProblemPage[] = [
  ...GAME_MOD_PAGES,
  ...VIDEO_PAGES,
  ...PC_CLEANUP_PAGES,
  ...PHOTOS_FILES_PAGES,
  ...PDF_EXCEL_PAGES,
  ...DOCUMENT_PAGES,
  ...AUDIO_PAGES,
  ...LOCAL_AI_PAGES,
];
