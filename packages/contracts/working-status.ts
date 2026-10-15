const AGENT_WORK_VARIATIONS: readonly string[] = [
  "On it",
  "Working on it",
  "Got it",
  "Handling it",
  "Taking care of it",
  "Sorting it",
  "Doing the thing",
  "Making it happen",
  "Just a sec",
  "One moment",
];

const SHELL_COMMAND_VARIATIONS: readonly string[] = [
  "Running it",
  "Working on it",
  "Running a command",
  "Getting it done",
  "On it",
  "Handling it",
  "Making it happen",
  "Just a sec",
];

const CODE_VARIATIONS: readonly string[] = [
  "Working on it",
  "Getting it done",
  "On it",
  "Handling it",
  "Making it happen",
  "Just a sec",
];

const TOOL_STATUS_BY_NAME: Record<string, readonly string[]> = {
  image_gen: [
    "Sketching",
    "Drawing",
    "Sketching it out",
    "Drawing it up",
    "Mocking it up",
    "Painting a picture",
    "Whipping up a visual",
    "Making an image",
    "Starting the render",
    "Setting the scene",
  ],
  web: [
    "Searching",
    "Looking it up",
    "Googling",
    "Checking online",
    "Searching the web",
    "Looking that up",
    "Browsing",
    "Hunting it down",
    "Asking the internet",
    "Finding out",
  ],
  schedule: [
    "Scheduling",
    "Calendaring",
    "Penciling it in",
    "Booking it",
    "Saving the date",
    "Adding to your calendar",
    "Locking in the time",
    "Marking it down",
    "Setting a reminder",
    "Putting it on the schedule",
  ],
  context: [
    "Looking back",
    "Checking my notes",
    "Checking recent notes",
    "Finding the thread",
    "Looking for the reference",
    "Checking recent activity",
    "Finding the background",
    "Catching up",
    "Getting oriented",
    "Looking at what matters",
  ],
  remember: [
    "Making a note",
    "Filing that away",
    "Writing it down",
    "Committing it to memory",
    "Jotting that down",
    "Saving that for later",
    "Tucking it away",
    "Adding it to my notes",
  ],
  spawn_agent: AGENT_WORK_VARIATIONS,
  send_message: AGENT_WORK_VARIATIONS,
  agent_status: [
    "Checking on it",
    "Seeing how it's going",
    "Peeking at progress",
    "Checking in",
    "Taking a look",
    "Getting a status read",
  ],
  stop_agent: [
    "Stopping",
    "Calling a halt",
    "Wrapping it up",
    "Bringing it to a stop",
    "Halting",
    "Standing down",
  ],

  bash: SHELL_COMMAND_VARIATIONS,
  exec_command: SHELL_COMMAND_VARIATIONS,
  code: CODE_VARIATIONS,
  node_repl: CODE_VARIATIONS,
  read: [
    "Reading",
    "Looking it over",
    "Taking a look",
    "Reading through",
    "Checking the file",
    "Skimming it",
    "Pulling it up",
    "Having a read",
  ],
  write: [
    "Writing",
    "Saving it",
    "Writing it out",
    "Putting it down",
    "Drafting the file",
    "Getting it written",
    "Setting it up",
  ],
  edit: [
    "Editing",
    "Making changes",
    "Tweaking it",
    "Updating it",
    "Refining it",
    "Adjusting things",
    "Touching it up",
  ],
  apply_patch: [
    "Making changes",
    "Applying the changes",
    "Editing the code",
    "Patching it",
    "Wiring it up",
    "Putting it together",
    "Updating the code",
  ],
  str_replace: [
    "Editing",
    "Making changes",
    "Tweaking it",
    "Updating the text",
    "Swapping things out",
    "Refining it",
  ],
  grep: [
    "Searching",
    "Looking it up",
    "Hunting it down",
    "Scanning through",
    "Finding it",
    "Digging in",
    "Searching the files",
  ],
  glob: [
    "Looking for files",
    "Finding files",
    "Scanning the folder",
    "Searching files",
    "Tracking files down",
    "Browsing files",
  ],
  view_image: [
    "Taking a look",
    "Viewing the image",
    "Checking the image",
    "Looking at it",
    "Studying the picture",
    "Examining it",
  ],
  write_stdin: [
    "Sending input",
    "Typing it in",
    "Passing it along",
    "Feeding it in",
    "Responding",
    "Sending it over",
  ],
  tool_search: [
    "Finding the right tool",
    "Looking for tools",
    "Picking a tool",
    "Searching tools",
    "Lining up the tools",
    "Choosing how",
  ],
  request_credential: [
    "Asking for access",
    "Requesting access",
    "Getting permission",
    "Lining up access",
    "Checking access",
    "Asking to connect",
  ],
  ask_user: [
    "Asking you",
    "Checking with you",
    "Waiting on you",
    "Getting your call",
    "Asking first",
    "Running it by you",
  ],
  request_secure_input: [
    "Asking for a value",
    "Requesting access",
    "Asking you to fill it in",
    "Lining up access",
    "Waiting on a value",
    "Asking for the details",
  ],
  use_secure_value: [
    "Using it without looking",
    "Filling it in",
    "Entering it",
    "Passing it along",
    "Handing it over",
    "Putting it in",
  ],
  multi_tool_use_parallel: [
    "Juggling a few things",
    "Doing several things",
    "Working in parallel",
    "Handling a few things",
    "Multitasking",
    "Running things together",
  ],
  import_source: [
    "Pulling it in",
    "Importing it",
    "Bringing it in",
    "Loading the source",
    "Fetching it",
    "Reading it in",
  ],
  script_draft: [
    "Drafting",
    "Sketching it out",
    "Writing the script",
    "Putting it together",
    "Outlining it",
    "Drafting the steps",
  ],
  html: [
    "Building it",
    "Putting it together",
    "Laying it out",
    "Designing it",
    "Mocking it up",
    "Drafting the page",
  ],
  computer_use: [
    "Using the computer",
    "Working on the desktop",
    "Driving the computer",
    "Handling it",
    "On it",
  ],
  browser: [
    "Using the browser",
    "Looking it up",
    "Browsing",
    "Checking the page",
    "On it",
  ],
  task: [
    "On it",
    "Handling it",
    "Working on it",
    "Taking care of it",
    "Getting it done",
    "Making it happen",
  ],

  schedule_add: [
    "Scheduling it",
    "Setting it up",
    "Adding it",
    "Penciling it in",
    "Booking it",
  ],
  schedule_list: [
    "Checking the schedule",
    "Looking at what's planned",
    "Reviewing the schedule",
    "Pulling up the schedule",
  ],
  schedule_update: [
    "Updating the schedule",
    "Adjusting it",
    "Rescheduling",
    "Tweaking the timing",
  ],
  schedule_remove: [
    "Clearing it",
    "Removing it",
    "Canceling it",
    "Taking it off the schedule",
  ],

  cron_add: [
    "Scheduling it",
    "Setting it up",
    "Adding it",
    "Penciling it in",
    "Booking it",
  ],
  cron_list: [
    "Checking the schedule",
    "Looking at what's planned",
    "Reviewing the schedule",
    "Pulling up the schedule",
  ],
  cron_remove: [
    "Clearing it",
    "Removing it",
    "Canceling it",
    "Taking it off the schedule",
  ],
  cron_run: [
    "Running it",
    "Kicking it off",
    "Triggering it",
    "Setting it in motion",
  ],
  cron_update: [
    "Updating the schedule",
    "Adjusting it",
    "Rescheduling",
    "Tweaking the timing",
  ],
  heartbeat_get: [
    "Checking in",
    "Taking a pulse",
    "Checking status",
    "Seeing how it's going",
  ],
  heartbeat_run: [
    "Running a check",
    "Checking in",
    "Taking a pulse",
    "Testing it",
  ],
  heartbeat_upsert: [
    "Saving the status",
    "Updating the check-in",
    "Logging it",
    "Recording it",
  ],

  powershell: SHELL_COMMAND_VARIATIONS,
  shell: SHELL_COMMAND_VARIATIONS,
  local_shell: SHELL_COMMAND_VARIATIONS,
  heartbeat: ["Checking in", "Taking a pulse", "Checking status"],
  bash_output: ["Checking the output", "Seeing how it went", "Checking on it"],
  kill_shell: ["Stopping it", "Halting", "Wrapping it up"],
  kill_bash: ["Stopping it", "Halting", "Wrapping it up"],
  web_search: [
    "Searching the web",
    "Looking it up",
    "Checking online",
    "Searching",
    "Asking the internet",
  ],
  web_fetch: [
    "Reading a page",
    "Pulling up the page",
    "Checking the page",
    "Reading it online",
  ],
  multi_edit: [
    "Editing",
    "Making changes",
    "Tweaking it",
    "Updating it",
  ],
  notebook_edit: ["Editing the notebook", "Making changes", "Updating it"],
  ls: ["Looking for files", "Checking the folder", "Browsing files"],
  find: ["Looking for files", "Finding files", "Searching files"],
  todo_write: ["Planning it out", "Making a plan", "Lining up the steps"],
  agent: AGENT_WORK_VARIATIONS,
  no_response: ["Wrapping up", "Finishing up", "Almost done"],
  switch_destination: [
    "Moving over",
    "Switching places",
    "Picking it up elsewhere",
    "Heading over",
  ],
  drive: ["Checking your Drive", "Working with files", "Pulling up files"],
  drive_upload: [
    "Saving to your Drive",
    "Uploading it",
    "Putting it in your Drive",
  ],
  drive_download: [
    "Getting it from your Drive",
    "Downloading it",
    "Pulling it from your Drive",
  ],
  map: ["Making a map", "Mapping it out", "Finding it on the map", "Plotting it"],
  connector_status: [
    "Checking your connections",
    "Checking your accounts",
    "Seeing what's connected",
  ],
  video_gen: [
    "Making a video",
    "Filming it",
    "Rolling the camera",
    "Starting the render",
  ],
  history: [
    "Looking back",
    "Checking our past chats",
    "Finding the thread",
    "Catching up",
  ],
  memory: [
    "Checking my notes",
    "Looking back",
    "Pulling up my notes",
  ],
  slack_memory: ["Checking my notes", "Looking back", "Catching up"],
  slack_repo: ["Choosing the repository", "Picking the project"],
};


const RAW_TOOL_STATUS_PATTERN =
  /^(?:running|executing|calling|invoking)\s+(.+)$/i;

const MCP_TOOL_PREFIX = /^mcp__.+?__/;

const toToolStatusKey = (value: string): string =>
  value
    .trim()
    .replace(MCP_TOOL_PREFIX, "")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[_\s-]+/g, "_")
    .replace(/:+$/g, "")
    .toLowerCase();

const CODE_TOOL_KEYS = new Set(["code", "node_repl"]);

const CODE_ACTIVITY_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bmemory\s*\.\s*(?:write|edit|append|update|remove|delete)\s*\(/, "remember"],
  [/\bmemory\s*\.\s*(?:read|list|search)\s*\(/, "memory"],
  [/\bhistory\s*\.\s*(?:search|read|sql)\s*\(/, "history"],
  [/\btools\s*(?:\.\s*|\[\s*\\?["'])image_gen\b/, "image_gen"],
  [/\btools\s*(?:\.\s*|\[\s*\\?["'])video_gen\b/, "video_gen"],
  [/\btools\s*(?:\.\s*|\[\s*\\?["'])web\b/, "web"],
  [/\btools\s*(?:\.\s*|\[\s*\\?["'])schedule_/, "schedule"],
  [/\btools\s*(?:\.\s*|\[\s*\\?["'])drive_upload\b/, "drive_upload"],
  [/\btools\s*(?:\.\s*|\[\s*\\?["'])drive_download\b/, "drive_download"],
  [/\bsky\s*\./, "computer_use"],
  [/\bbrowser\s*\./, "browser"],
];

export function workingToolName(name: string, args?: unknown): string {
  if (!CODE_TOOL_KEYS.has(toToolStatusKey(name)) || args === undefined) {
    return name;
  }
  let source: string;
  if (typeof args === "string") source = args;
  else {
    try {
      source = JSON.stringify(args) ?? "";
    } catch {
      return name;
    }
  }
  for (const [pattern, activity] of CODE_ACTIVITY_PATTERNS) {
    if (pattern.test(source)) return activity;
  }
  return name;
}

const looksLikeJsonBlob = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return true;
  if (trimmed.includes("\n") && /[{[]/.test(trimmed)) return true;
  return /"(?:session_id|exit_code|wall_time_seconds|original_token_count)"\s*:/.test(
    trimmed,
  );
};

const PLAIN_EXEC_COMMAND_RESULT_PATTERN =
  /^Wall time: [^\n]+ seconds\nProcess (still running with session ID|running with session ID|exited with code) ([^\n]+)\nOriginal token count: \d+\n/;

const tryFriendlyExecCommandStatus = (value: string): string | undefined => {
  const plainResult = PLAIN_EXEC_COMMAND_RESULT_PATTERN.exec(value);
  if (plainResult) {
    const exitCode = Number(plainResult[2]);
    return plainResult[1] === "exited with code" && exitCode !== 0
      ? "Command failed"
      : computeStatus({ toolName: "Bash", seed: "" });
  }
  if (!looksLikeJsonBlob(value)) return undefined;
  const looksLikeExecPayload =
    /"session_id"\s*:/.test(value) &&
    (/"command"\s*:/.test(value) ||
      /"exit_code"\s*:/.test(value) ||
      /"running"\s*:/.test(value));
  if (!looksLikeExecPayload) return undefined;
  try {
    const parsed = JSON.parse(value) as {
      running?: unknown;
      exit_code?: unknown;
    };
    if (
      parsed.running !== true &&
      typeof parsed.exit_code === "number" &&
      parsed.exit_code !== 0
    ) {
      return "Command failed";
    }
  } catch {
    // Truncated or pretty-printed payloads still must not render raw.
  }
  return computeStatus({ toolName: "Bash", seed: "" });
};

const looksLikeRawToolIdentifier = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  return (
    /^[a-z][a-z0-9]*(?:_{1,2}[a-z0-9]+)+$/.test(trimmed) ||
    /^[A-Z][a-zA-Z0-9]+(?:[A-Z][a-zA-Z0-9]+)+$/.test(trimmed)
  );
};

const looksLikeMachineStatus = (value: string): boolean => {
  if (looksLikeJsonBlob(value)) return true;
  if (value.length > 120) return true;
  if (value.includes("\n")) return true;
  if (looksLikeRawToolIdentifier(value)) return true;
  return false;
};

export function normalizeDisplayStatusText(
  statusText: string | undefined,
): string | undefined {
  if (!statusText) return undefined;
  const trimmed = statusText.trim();
  if (!trimmed) return undefined;

  const execStatus = tryFriendlyExecCommandStatus(trimmed);
  if (execStatus) return execStatus;

  const match = RAW_TOOL_STATUS_PATTERN.exec(trimmed);
  if (match) {
    const rawToolName = match[1]!;
    const toolName = toToolStatusKey(rawToolName);
    if (TOOL_STATUS_BY_NAME[toolName]) {
      return computeStatus({ toolName, seed: "" });
    }
    const firstToken = toToolStatusKey(rawToolName.split(/\s+/)[0] ?? "");
    if (firstToken && TOOL_STATUS_BY_NAME[firstToken]) {
      return computeStatus({ toolName: firstToken, seed: "" });
    }
    if (rawToolName.includes(" ") && !looksLikeMachineStatus(rawToolName)) {
      return trimmed;
    }
    return computeStatus({ toolName, seed: "" });
  }

  const bareToolName = toToolStatusKey(trimmed);
  if (!/\s/.test(trimmed) && TOOL_STATUS_BY_NAME[bareToolName]) {
    return computeStatus({ toolName: bareToolName, seed: "" });
  }

  if (looksLikeMachineStatus(trimmed)) {
    return computeStatus({ toolName: "unknown", seed: trimmed });
  }

  return trimmed;
}

const FALLBACK_VARIATIONS: readonly string[] = [
  "Working on it",
  "On it",
  "Just a sec",
  "One moment",
  "Handling it",
  "Looking into it",
  "On the case",
];

const hashSeed = (seed: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const pickVariation = (
  options: readonly string[],
  seed: string | undefined,
): string => {
  if (options.length === 0) return "";
  if (options.length === 1 || !seed) return options[0]!;
  return options[hashSeed(seed) % options.length]!;
};

const STILL_STATUS_BY_NAME: Record<string, string> = {
  web: "Still searching",
  grep: "Still searching",
  glob: "Still looking for files",
  image_gen: "Still drawing",
  bash: "Still running it",
  exec_command: "Still running it",
  code: "Still working on it",
  node_repl: "Still working on it",
  read: "Still reading",
  write: "Still writing",
  edit: "Still making changes",
  str_replace: "Still making changes",
  apply_patch: "Still making changes",
  view_image: "Still looking",
  browser: "Still browsing",
  computer_use: "Still using the computer",
  html: "Still building it",
  context: "Still looking back",
  remember: "Still making a note",
  schedule: "Still scheduling",
  schedule_add: "Still scheduling",
  ask_user: "Still waiting on you",
  request_secure_input: "Still waiting on you",
  request_credential: "Still asking for access",
  spawn_agent: "Still on it",
  send_message: "Still on it",
  task: "Still on it",
  powershell: "Still running it",
  web_search: "Still searching",
  web_fetch: "Still reading",
  multi_edit: "Still making changes",
  video_gen: "Still filming",
  map: "Still mapping it out",
  history: "Still looking back",
  memory: "Still checking my notes",
  drive_upload: "Still uploading",
  drive_download: "Still downloading",
  switch_destination: "Still moving over",
};

export function computeStillStatus(toolName: string): string {
  return (
    STILL_STATUS_BY_NAME[toToolStatusKey(toolName)] ?? "Still working on it"
  );
}

export function computeStatus({
  toolName,
  seed,
}: {
  toolName?: string;
  seed?: string;
} = {}): string {
  if (toolName) {
    const normalizedToolName = toToolStatusKey(toolName);
    const mapped = TOOL_STATUS_BY_NAME[normalizedToolName];
    if (mapped) return pickVariation(mapped, seed ?? normalizedToolName);
    return pickVariation(FALLBACK_VARIATIONS, seed ?? normalizedToolName);
  }

  return "";
}

export const WORKING_INDICATOR_THINKING_LABEL_MS = 3500;
export const WORKING_INDICATOR_LONG_THINKING_MS = 15000;
export const WORKING_INDICATOR_LONG_TOOL_MS = 15000;
export const WORKING_INDICATOR_THINKING_TEXT = "Thinking";
export const WORKING_INDICATOR_LONG_THINKING_TEXT = "Thinking it through";

export function getWorkingIndicatorThinkingText(elapsedMs: number): string {
  if (elapsedMs >= WORKING_INDICATOR_LONG_THINKING_MS) {
    return WORKING_INDICATOR_LONG_THINKING_TEXT;
  }
  if (elapsedMs >= WORKING_INDICATOR_THINKING_LABEL_MS) {
    return WORKING_INDICATOR_THINKING_TEXT;
  }
  return "";
}
