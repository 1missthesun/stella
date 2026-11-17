export const EMAIL_TOOL_NAME = "email";

export const EMAIL_TOOL_ACTIONS = ["inbox", "read", "search", "draft", "send", "archive", "page", "rules", "off"] as const;

export const EMAIL_TOOL_DESCRIPTOR = {
  name: EMAIL_TOOL_NAME,
  label: "Email",
  workingText: "Reading email",
  description:
    "The user's Gmail, every account connected through Stella. With Email on you read the mail yourself and keep the user's Email page; see the Email section of your instructions for when.\n" +
    "- inbox: what arrived (and what the user sent) since your last read, grouped by thread with mailing lists folded, plus the rules and the current page. Reading it marks it read.\n" +
    "- read: a whole thread (`account`, `thread`). search: Gmail search syntax (`query`, optional `account`); works on all mail, read or not.\n" +
    "- draft: saves a reply in the thread of `message` as a Gmail draft (`body` plain text, written as the user; `all` to reply to everyone). send: sends it; only when the user said to send this reply (a tap on its button counts), passing `draft` (a draft id) to delete the draft it replaces.\n" +
    "- archive: `threads` [{account, thread}] out of the inbox; `undo`: true puts them back.\n" +
    "- page: updates the Email page. `items` [{id, section: needs_you|handled|waiting, title, gist, detail?, action?, draft?, draftId?, from?, count?, threads?, urgent?}] adds or changes items by id (only the fields given change; null clears one), `remove` [ids] drops them, `ignored` {count, gist, senders: [{name, count}]} replaces the ignored summary. `action` is the item's one button, 2 to 4 words (\"Send reply\", \"Pay it\", \"Confirm 7:30\"), left out when there is no step. `draft` is the text of the reply you drafted (shown for review) and `draftId` its Gmail draft id. urgent (needs_you only) reaches the user's phone the first time it is set.\n" +
    "- rules: `op` list (default), add (`text` their words, `when` which emails, `kind` wake = tell them at once | act = do what it says at once | ignore = leave it off the page), remove (`rule`), or note (`note`, a few sentences on what matters to them).\n" +
    "- off: turns Email off, when the user asks.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: EMAIL_TOOL_ACTIONS },
      account: { type: "string", description: "The Gmail address it is in (needed when several are connected)." },
      thread: { type: "string", description: "read: the thread id." },
      query: { type: "string", description: "search: Gmail search syntax." },
      message: { type: "string", description: "draft/send: the message id being answered." },
      body: { type: "string", description: "draft/send: the reply text, without the quoted original." },
      all: { type: "boolean", description: "draft/send: reply to everyone on it." },
      draft: { type: "string", description: "send: the id of the draft this replaces." },
      threads: {
        type: "array",
        items: {
          type: "object",
          properties: { account: { type: "string" }, thread: { type: "string" } },
          required: ["account", "thread"],
        },
        description: "archive: the threads; page items: the threads an item stands for.",
      },
      undo: { type: "boolean", description: "archive: put back in the inbox." },
      items: {
        type: "array",
        items: { type: "object", additionalProperties: true, properties: { id: { type: "string" } }, required: ["id"] },
        description: "page: items to add or change.",
      },
      remove: { type: "array", items: { type: "string" }, description: "page: item ids to drop." },
      ignored: { type: "object", additionalProperties: true, description: "page: the ignored summary." },
      op: { type: "string", enum: ["list", "add", "remove", "note"] },
      text: { type: "string", description: "rules add: the rule in the user's words." },
      when: { type: "string", description: "rules add: which emails it is about, e.g. \"Mail from the landlord about rent\"." },
      kind: { type: "string", enum: ["wake", "act", "ignore"] },
      rule: { type: "string", description: "rules remove: the rule id." },
      note: { type: "string", description: "rules note: the whole new note." },
    },
    required: ["action"],
  },
} as const;
