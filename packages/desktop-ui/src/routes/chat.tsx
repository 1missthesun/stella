import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ChatApp } from "@/app/chat/App";

const ChatSearch = z.object({
  c: z.string().optional(),
});

export const Route = createFileRoute("/chat")({
  validateSearch: ChatSearch,
  component: ChatApp,
});
