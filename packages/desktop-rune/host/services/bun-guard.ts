// Imported by the host entries right after ./stdio, before anything else loads: a host started on
// a Bun other than Stella's pinned one exits with a clear message (services/stella-bun.ts).

import { requirePinnedBun } from "./stella-bun";

requirePinnedBun("host");
