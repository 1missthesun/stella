export const CLOUD_HOME_LOCAL_SCAN_VERSION = 1 as const;
export const CLOUD_SKILL_MAX_PACKAGES = 50;
export const CLOUD_SKILL_MAX_FILES = 256;
export const CLOUD_SKILL_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const CLOUD_SKILL_MAX_TOTAL_BYTES = 25 * 1024 * 1024;
export const CLOUD_HOME_LOCAL_SKILLS_SCAN_MAX_BYTES = 50 * 1024 * 1024;

export type CloudHomeImportOwnership =
  | "owned"
  | "unclaimed"
  | "anonymous"
  | "other_owner"
  | "corrupt";

export type LocalCloudSkillFile = {
  path: string;
  contentType: string;
  base64: string;
  sha256: string;
  sizeBytes: number;
};

export type LocalCloudSkillPackage = {
  slug: string;
  name: string;
  description: string;
  source: "desktop_sync";
  availability: "both";
  treeSha256: string;
  fileCount: number;
  totalSizeBytes: number;
  files: LocalCloudSkillFile[];
};

export type CloudHomeScanWarningCode =
  | "invalid_path"
  | "unsafe_file"
  | "document_too_large"
  | "skill_invalid"
  | "skill_too_large"
  | "skill_limit"
  | "read_failed";

export type CloudHomeScanWarning = {
  code: CloudHomeScanWarningCode;
  path: string;
  message: string;
};

export type LocalCloudHomeScan = {
  schemaVersion: typeof CLOUD_HOME_LOCAL_SCAN_VERSION;
  skills: LocalCloudSkillPackage[];
  warnings: CloudHomeScanWarning[];
};

export type CloudSkillHead = {
  skillId: string;
  ownerGeneration: string;
  slug: string;
  name: string;
  description: string;
  source:
    | "bundled"
    | "desktop_sync"
    | "mobile_sync"
    | "cloud_created"
    | "owner_migration";
  availability: "orchestrator" | "general" | "both";
  revision: number;
  versionId?: string;
  manifestSha256?: string;
  treeSha256?: string;
  fileCount?: number;
  totalSizeBytes?: number;
  updatedAt: number;
};

export type CloudSkillMirrorDeletion = {
  status: "deleted" | "conflict";
};

export type CloudHomeSyncErrorCode =
  | "not_available"
  | "not_authenticated"
  | "scan_failed"
  | "cloud_unavailable"
  | "cloud_conflict"
  | "verification_failed"
  | "import_confirmation_required"
  | "local_owner_mismatch"
  | "local_owner_record_invalid";

export type CloudHomeSyncIssue = {
  code: CloudHomeSyncErrorCode;
  item?: string;
  message: string;
};

export type CloudHomeSyncPhase =
  | "idle"
  | "scanning"
  | "reconciling"
  | "complete"
  | "attention"
  | "unavailable";

export type CloudHomeSyncStatus = {
  accountScope: string | null;
  phase: CloudHomeSyncPhase;
  skillsUploaded: number;
  skillsCloudWins: number;
  skipped: number;
  warnings: CloudHomeScanWarning[];
  issues: CloudHomeSyncIssue[];
  lastCompletedAt?: number;
};

export type CloudHomeSyncCursor = {
  schemaVersion: 1;
  skills: Record<
    string,
    { localTreeSha256: string; cloudVersionId?: string; cloudRevision: number }
  >;
  lastCompletedAt?: number;
};
