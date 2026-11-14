import type { ProblemPage } from "../types";
import { AUDIO_PAGES } from "./audio";
import { CHATS_DATA_EXPORTS_PAGES } from "./chats-data-exports";
import { CONTACTS_CALENDAR_EMAIL_PAGES } from "./contacts-calendar-email";
import { DOCUMENT_PAGES } from "./documents";
import { FILES_FOLDERS_PAGES } from "./files-folders";
import { GAME_MOD_PAGES } from "./game-mods";
import { LOCAL_AI_PAGES } from "./local-ai";
import { MONEY_HOUSEHOLD_PAGES } from "./money-household";
import { PC_CLEANUP_PAGES } from "./pc-cleanup";
import { PDF_EXCEL_PAGES } from "./pdf-excel";
import { READING_WRITING_PAGES } from "./reading-writing";
import { HOBBIES_PAGES } from "./hobbies";
import { PHOTOS_FILES_PAGES } from "./photos-files";
import { PRINTING_LABELS_PAGES } from "./printing-labels";
import { STUDY_PAGES } from "./study";
import { VIDEO_PAGES } from "./video";
import { WEDDINGS_EVENTS_PAGES } from "./weddings-events";

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
  ...FILES_FOLDERS_PAGES,
  ...CONTACTS_CALENDAR_EMAIL_PAGES,
  ...STUDY_PAGES,
  ...PRINTING_LABELS_PAGES,
  ...WEDDINGS_EVENTS_PAGES,
  ...MONEY_HOUSEHOLD_PAGES,
  ...CHATS_DATA_EXPORTS_PAGES,
  ...READING_WRITING_PAGES,
  ...HOBBIES_PAGES,
];
