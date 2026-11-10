// App Store listing for `eas metadata:push` (eas.json points `metadataPath` here).
//
// The listing itself lives in store.config.json. The App Review contact (a
// person's name and phone number) is not kept in this public repo: it is read at
// push time from environment variables or from a local file outside the repo.
// See "App Store review contact" in DEPLOY.md.
//
//   STELLA_ASC_REVIEW_FIRST_NAME, STELLA_ASC_REVIEW_LAST_NAME,
//   STELLA_ASC_REVIEW_PHONE, STELLA_ASC_REVIEW_EMAIL (optional)
//
// or a JSON file { "firstName", "lastName", "phone", "email"? } at
// $STELLA_ASC_REVIEW_CONTACT_FILE, defaulting to
// ~/.config/stella-dev/app-store-review-contact.json. Environment variables win
// over the file, field by field. A missing field stops the push.

const fs = require("fs");
const os = require("os");
const path = require("path");

const listing = require("./store.config.json");

const PERSONAL_FIELDS = ["firstName", "lastName", "phone"];

const ENV_BY_FIELD = {
  firstName: "STELLA_ASC_REVIEW_FIRST_NAME",
  lastName: "STELLA_ASC_REVIEW_LAST_NAME",
  phone: "STELLA_ASC_REVIEW_PHONE",
  email: "STELLA_ASC_REVIEW_EMAIL",
};

function contactFilePath() {
  const fromEnv = process.env.STELLA_ASC_REVIEW_CONTACT_FILE;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return path.join(
    os.homedir(),
    ".config",
    "stella-dev",
    "app-store-review-contact.json",
  );
}

function readContactFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return {};
    throw new Error(
      `Could not read the App Store review contact file ${file}: ${error.message}`,
    );
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    throw new Error(
      `The App Store review contact file ${file} is not valid JSON: ${error.message}`,
    );
  }
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

module.exports = () => {
  const committedReview = (listing.apple && listing.apple.review) || {};
  const leaked = PERSONAL_FIELDS.filter((field) =>
    text(committedReview[field]),
  );
  if (leaked.length > 0) {
    // `eas metadata:pull` writes the live contact back into store.config.json.
    throw new Error(
      `packages/mobile/store.config.json has apple.review.${leaked.join(", apple.review.")} set. ` +
        "Move the review contact to the local contact file or environment variables " +
        '(see DEPLOY.md, "App Store review contact") and delete those fields from store.config.json before committing.',
    );
  }

  const file = contactFilePath();
  const fromFile = readContactFile(file);
  const contact = {};
  for (const [field, envName] of Object.entries(ENV_BY_FIELD)) {
    const value = text(process.env[envName]) || text(fromFile[field]);
    if (value) contact[field] = value;
  }

  const missing = PERSONAL_FIELDS.filter((field) => !contact[field]);
  if (missing.length > 0) {
    throw new Error(
      `App Store review contact is missing ${missing.join(", ")}. ` +
        `Set ${missing.map((field) => ENV_BY_FIELD[field]).join(", ")} or put them in ${file} ` +
        '(see DEPLOY.md, "App Store review contact"). Refusing to push the listing with a blank review contact.',
    );
  }

  return {
    ...listing,
    apple: {
      ...listing.apple,
      review: { ...committedReview, ...contact },
    },
  };
};
