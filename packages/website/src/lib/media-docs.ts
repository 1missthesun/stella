import { MEDIA_MODELS } from "@stella/contracts/media-models";

export const renderMediaDocsOverview = (): string => `# Stella media API

Run Stella's media models (images, video, music, speech, transcription, 3D)
on the user's Stella account. Inside Stella, use the \`stella-media\` CLI
(\`stella-media models\`, \`stella-media generate --wait --request '<json>'\`);
the HTTP API below is what it calls.

## One catalog, not separate operation pages

This is the canonical overview at https://stella.sh/docs/media. The old
category pages under /docs/media/ (images, video, audio, music, 3d) are retired.
The model list below is generated from packages/contracts/media-models.ts,
the same catalog used by Stella's media API and CLI; do not maintain a separate
list of operation aliases. Follow each model's linked schema for current fields.

## Models

${MEDIA_MODELS.map((model) => `- \`${model.id}\` (${model.kind}): ${model.does}\n  Input and output: ${model.docsUrl}`).join("\n")}

The current list is also served at \`GET <stella-api>/api/media/v1/models\`.

## Video references and extension

Choose a video model from the catalog above: text-to-video for a prompt,
image-to-video to animate an image (optionally to an end frame),
reference-to-video for guidance from reference images, videos and audio
(reference_image_urls, reference_video_urls, reference_audio_urls, or an
ordered reference_conditions list), and extend-video to continue an existing
video. There is no general prompt-driven video editing model in the catalog.
Read each model's linked schema for limits. These are models, not separate
Stella operations named image_to_video, video_extend or video_to_video.

On a computer, the stella-media CLI can call any listed model with its native
input. In Stella's cloud, the video_gen convenience tool only exposes text and
image-to-video, not references or extension. Use a computer with the CLI when
those inputs are needed.

Video requires the video_generation plan capability and available usage budget.
Every clip has generated sound at no extra cost. Video is priced per second of
the requested duration and by resolution (480P, 768P or 1080P; 768P is the
default), so set an explicit duration. Reference inputs above the model's
included allowance add to the price.

## Start a job

\`\`\`
POST <stella-api>/api/media/v1/generate
Content-Type: application/json
Authorization: Bearer <stella-session-token>
Idempotency-Key: <optional; a retry with the same key and body reattaches>

{ "model": "<model id>", "input": { ...the model's own input... } }
\`\`\`

\`<stella-api>\` is the Stella backend the user is signed in to; reuse their
session token. \`input\` is exactly what the model's page documents, with its
field names and values; Stella does not rename or fill in anything. A file can
be an http(s) URL or a \`data:<mime>;base64,...\` URI anywhere in \`input\` (the
whole body is limited to 24 MB); data URIs are stored and passed on as URLs.

Answer (202): \`{ "jobId": "...", "model": "...", "status": "queued" }\`.

## Watch it

\`GET <stella-api>/api/media/v1/job?jobId=<jobId>\` until \`status\` is
\`succeeded\`, \`failed\` or \`canceled\`. A succeeded job's \`output\` is the
model's own output, with every file \`url\` replaced by a signed copy Stella
keeps (valid for an hour from each read). A failed job's \`error.message\` is the
model's complaint, which says what to change in the input.

Cancel: \`DELETE <stella-api>/api/media/v1/job\` with the job's
\`Idempotency-Key\`.

## Errors

- 400: unknown model, or the model refused the input (the message says why).
- 401 \`auth_required\`: the user is signed out. Show them \`action\`, then retry.
- 402 \`CAPABILITY_REQUIRED\`: their plan does not include this kind of media.
- 429: their usage limit or the request rate is reached; \`retryAfterMs\` says when.
`;
