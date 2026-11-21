import { createFileRoute } from "@tanstack/react-router";
import { ChatApp } from "@/app/chat/App";

type ChatSearch = { c?: string };

export const Route = createFileRoute("/chat")({
  validateSearch: (search: Record<string, unknown>): ChatSearch =>
    typeof search.c === "string" ? { c: search.c } : {},
  component: ChatApp,
});
