/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

export const emailSchema = z.string().email('Invalid email format');

export const emailArraySchema = z.union([emailSchema, z.array(emailSchema)]);

export const iso8601DateTimeSchema = z.string().refine(
  (val) => {
    const iso8601Regex =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})$/;
    if (!iso8601Regex.test(val)) return false;

    const date = new Date(val);
    return !isNaN(date.getTime());
  },
  {
    message:
      'Invalid ISO 8601 datetime format. Expected format: YYYY-MM-DDTHH:mm:ss[.sss][Z|±HH:mm]',
  },
);

export const googleDocumentIdSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'Invalid document ID format. Document IDs should only contain letters, numbers, hyphens, and underscores',
  );

export function extractDocumentId(urlOrId: string): string {
  if (googleDocumentIdSchema.safeParse(urlOrId).success) {
    return urlOrId;
  }

  const urlMatch = urlOrId.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }

  throw new Error('Invalid document ID or URL');
}

