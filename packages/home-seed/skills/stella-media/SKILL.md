---
name: stella-media
description: Generate images, video, music, speech and 3D models, or transcribe audio, through Stella's media models. Use when the user asks for any generated media or a transcription. Don't call provider APIs directly — Stella handles auth, billing, and keeping the files.
---

# Generating media via Stella

`stella-media` (on PATH in Bash) runs Stella's media models on Stella's account, billed to the user's plan.

**In the cloud** (an agent running in Stella's cloud, with no `stella-media` on PATH): use the `image_gen` and `video_gen` tools instead. They run the same models on the same account, save the result to the user's drive, and attach it to your report; the result also gives a download URL if your shell needs the file. Other media kinds (music, speech, 3D) are not available there yet.

## 1. Pick a model

```bash
stella-media models
```

The canonical overview is https://stella.sh/docs/media (not the retired
`/docs/media/images`, `/video`, `/audio`, `/music` or `/3d` pages). The overview
and `stella-media models` are generated from `packages/contracts/media-models.ts`;
use that live list rather than a copied model or operation table. The HTTP list is
`GET <stella-api>/api/media/v1/models` on the user's signed-in Stella backend.

Each line is a model id, what it does, and its docs page. Read the docs page (`web` fetch it) before the first call to a model: it is the model's own input and output schema, and Stella passes your input to the model untouched.

For video, pick the model for text, image animation or multimodal references
from that list. Reference-to-video supports reference generation, editing and
extension through its own `task` input (`reference`, `editing`, `extension`);
read its linked schema for `image_urls`, `video_urls`, `audio_urls` and limits.
These are not separate Stella operations named `video_extend` or `video_to_video`.
The cloud `video_gen` convenience tool only supports text-to-video and
image-to-video; it does not expose multimodal references, editing or extension.
Use a computer with `stella-media` for those requests; do not substitute
`video_gen` or a direct provider call.

## 2. Run it

```bash
stella-media generate --wait --request '{"model":"<id>","input":{ ...the model's own input... }}'
```

- `input` is exactly what the model's docs page describes, with the same field names and values.
- A local file goes in as a `file://` URL anywhere a URL goes (`"image_url": "file:///Users/me/photo.png"`); it is uploaded with the request. Public http(s) URLs work as they are.
- `--wait` waits for the result and saves every file it produced under `~/.stella/media/outputs/`, printing the paths. Video and 3D take minutes; if it is still running at the timeout, it prints the job id — check later with `stella-media status --job-id <id> --save`. Never resubmit a job that is still running.
- A failed job prints the model's own error, which says what to change in the input.

## Rules

- If your context's `# Media generation` says off, don't try; tell the user what it says turns it on.
- Use Stella's models for generated media unless the task needs something they can't do. Calling providers directly bypasses the user's plan and Stella's copy of the files.
- Set the length and quality the user asked for; don't pick the most expensive options on your own (video bills per second, so set `duration` instead of leaving it to the model).
- **Signed out:** `stella-media` renews Stella's session itself, so an error saying to sign in means the user really is signed out. Stop, tell the Orchestrator to ask the user to sign in, and retry once they confirm. Don't loop.
- Still images in the chat are the Orchestrator's `image_gen`; use this skill for everything else, and for images when you need the files.
