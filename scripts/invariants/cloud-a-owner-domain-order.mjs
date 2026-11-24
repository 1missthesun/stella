import { readFileSync } from "node:fs";
import path from "node:path";

const FILE = "workers/cloud-builder/src/owner-store/domains.ts";

const MIGRATION_ORDER = [
  "systemDomain",
  "conversationsDomain",
  "agentThreadsDomain",
  "billingDomain",
  "devicesDomain",
  "appSourceDomain",
  "homeDomain",
  "driveDomain",
  "schedulesDomain",
  "preferencesDomain",
  "feedbackDomain",
  "accountDomain",
  "sharesDomain",
  "searchDomain",
  "mediaDomain",
  "voiceDomain",
  "abuseDomain",
  "integrationsDomain",
  "enginesDomain",
  "providersDomain",
  "projectsDomain",
  "browserDomain",
  "userAsksDomain",
  "claudeSessionsDomain",
  "agentEventsDomain",
  "agentReportsDomain",
  "emailDomain",
  "emailDigestLegacyDomain",
  "agentLogsDomain",
  "mcpServersDomain",
  "catchUpsDomain",
  "deviceOfflineDomain",
  "savedValuesDomain",
];

export async function check(root) {
  const source = readFileSync(path.join(root, FILE), "utf8");
  const match = /export const ownerDomains: OwnerDomain\[\] = \[([^\]]*)\];/.exec(source);
  if (!match) return [`${FILE}: ownerDomains array not found`];
  const listed = match[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const problems = [];
  MIGRATION_ORDER.forEach((name, index) => {
    if (listed[index] !== name) {
      problems.push(
        `${FILE}: ownerDomains[${index}] is ${listed[index] ?? "missing"}, expected ${name}. Domains run their migrations in this order: keep existing ones in place and append new domains at the end.`,
      );
    }
  });
  return problems;
}
