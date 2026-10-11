/**
 * Tool descriptions and JSON Schema parameters for the Google Workspace agent.
 * Descriptions align with gemini-cli-extensions/workspace (v0.0.7).
 */

export type GoogleWorkspaceToolMeta = {
  description: string;
  parameters: Record<string, unknown>;
};

const OBJ: Record<string, unknown> = {
  type: "object",
  additionalProperties: true,
};

export const GOOGLE_WORKSPACE_TOOL_METADATA: Record<
  string,
  GoogleWorkspaceToolMeta
> = {
  "auth.clear": {
    description:
      "Clears the authentication credentials, forcing a re-login on the next request.",
    parameters: { type: "object", properties: {} },
  },
  "auth.refreshToken": {
    description: "Manually triggers the token refresh process.",
    parameters: { type: "object", properties: {} },
  },
  "docs.create": {
    description:
      "Creates a new Google Doc. Can be blank or with initial text content.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "The title for the new Google Doc." },
        content: {
          type: "string",
          description: "The text content to create the document with.",
        },
      },
      required: ["title"],
    },
  },
  "docs.getSuggestions": {
    description: "Retrieves suggested edits from a Google Doc.",
    parameters: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "The ID of the document to retrieve suggestions from.",
        },
      },
      required: ["documentId"],
    },
  },
  "docs.getComments": {
    description:
      "Retrieves comments from a Google Doc or other Drive file (same as Drive comments API).",
    parameters: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "The document or file ID to retrieve comments from.",
        },
        fileId: {
          type: "string",
          description: "Alias of documentId for Drive file comments.",
        },
      },
    },
  },
  "docs.writeText": {
    description: "Writes text to a Google Doc at a specified position.",
    parameters: OBJ,
  },
  "docs.getText": {
    description: "Retrieves the text content of a Google Doc.",
    parameters: OBJ,
  },
  "docs.replaceText": {
    description:
      "Replaces all occurrences of a given text with new text in a Google Doc.",
    parameters: OBJ,
  },
  "docs.formatText": {
    description:
      "Applies formatting (bold, italic, headings, etc.) to text ranges in a Google Doc.",
    parameters: OBJ,
  },
  "drive.search": {
    description:
      "Searches for files and folders in Google Drive. The query can be a simple search term, a Google Drive URL, or a full query string.",
    parameters: {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Words to search for in file names and content, or a Drive query (e.g. \"name contains 'budget'\")."
        },
        "pageSize": {
          "type": "number"
        },
        "sharedWithMe": {
          "type": "boolean"
        }
      }
    },
  },
  "drive.findFolder": {
    description: "Finds a folder by name in Google Drive.",
    parameters: {
      "type": "object",
      "properties": {
        "folderName": {
          "type": "string",
          "description": "Folder name."
        }
      },
      "required": [
        "folderName"
      ]
    },
  },
  "drive.createFolder": {
    description: "Creates a new folder in Google Drive.",
    parameters: {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "Folder name."
        },
        "parentId": {
          "type": "string",
          "description": "Optional parent folder id."
        }
      },
      "required": [
        "name"
      ]
    },
  },
  "drive.downloadFile": {
    description:
      "Downloads the content of a file from Google Drive to a local path.",
    parameters: {
      "type": "object",
      "properties": {
        "fileId": {
          "type": "string",
          "description": "Drive file id or URL."
        },
        "localPath": {
          "type": "string",
          "description": "Absolute path to save to."
        }
      },
      "required": [
        "fileId",
        "localPath"
      ]
    },
  },
  "drive.renameFile": {
    description: "Renames a file or folder in Google Drive.",
    parameters: {
      "type": "object",
      "properties": {
        "fileId": {
          "type": "string",
          "description": "Drive file id or URL."
        },
        "newName": {
          "type": "string",
          "description": "New name."
        }
      },
      "required": [
        "fileId",
        "newName"
      ]
    },
  },
  "calendar.list": {
    description: "Lists all of the user's calendars.",
    parameters: { type: "object", properties: {} },
  },
  "calendar.createEvent": {
    description:
      "Creates a new event in a calendar. Supports optional Google Meet link generation and Google Drive file attachments.",
    parameters: {
      "type": "object",
      "properties": {
        "calendarId": {
          "type": "string",
          "description": "Calendar id; defaults to the primary calendar."
        },
        "summary": {
          "type": "string",
          "description": "Event title."
        },
        "description": {
          "type": "string",
          "description": "Event description."
        },
        "start": {
          "type": "object",
          "properties": {
            "dateTime": {
              "type": "string",
              "description": "RFC 3339 date-time with offset, e.g. 2026-10-12T15:00:00-07:00."
            }
          },
          "required": [
            "dateTime"
          ]
        },
        "end": {
          "type": "object",
          "properties": {
            "dateTime": {
              "type": "string",
              "description": "RFC 3339 date-time with offset, e.g. 2026-10-12T15:00:00-07:00."
            }
          },
          "required": [
            "dateTime"
          ]
        },
        "attendees": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Attendee email addresses."
        },
        "sendUpdates": {
          "type": "string",
          "enum": [
            "all",
            "externalOnly",
            "none"
          ]
        },
        "addGoogleMeet": {
          "type": "boolean"
        }
      },
      "required": [
        "summary",
        "start",
        "end"
      ]
    },
  },
  "calendar.listEvents": {
    description:
      "Lists events from a calendar. Defaults to upcoming events.",
    parameters: {
      "type": "object",
      "properties": {
        "calendarId": {
          "type": "string",
          "description": "Calendar id; defaults to primary."
        },
        "timeMin": {
          "type": "string",
          "description": "RFC 3339 lower bound."
        },
        "timeMax": {
          "type": "string",
          "description": "RFC 3339 upper bound."
        }
      }
    },
  },
  "calendar.getEvent": {
    description: "Gets the details of a specific calendar event.",
    parameters: {
      "type": "object",
      "properties": {
        "eventId": {
          "type": "string",
          "description": "Event id."
        },
        "calendarId": {
          "type": "string",
          "description": "Calendar id; defaults to primary."
        }
      },
      "required": [
        "eventId"
      ]
    },
  },
  "calendar.findFreeTime": {
    description: "Finds a free time slot for multiple people to meet.",
    parameters: {
      "type": "object",
      "properties": {
        "attendees": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Email addresses whose calendars to check (use the user's own address for just them)."
        },
        "timeMin": {
          "type": "string",
          "description": "RFC 3339 start of the search window."
        },
        "timeMax": {
          "type": "string",
          "description": "RFC 3339 end of the search window."
        },
        "duration": {
          "type": "number",
          "description": "Meeting length in minutes."
        }
      },
      "required": [
        "attendees",
        "timeMin",
        "timeMax",
        "duration"
      ]
    },
  },
  "calendar.updateEvent": {
    description:
      "Updates an existing event in a calendar. Supports adding Google Meet links and attachments.",
    parameters: {
      "type": "object",
      "properties": {
        "eventId": {
          "type": "string",
          "description": "Event id."
        },
        "calendarId": {
          "type": "string",
          "description": "Calendar id; defaults to primary."
        },
        "summary": {
          "type": "string",
          "description": "New title."
        },
        "description": {
          "type": "string",
          "description": "New description."
        },
        "start": {
          "type": "object",
          "properties": {
            "dateTime": {
              "type": "string",
              "description": "RFC 3339 date-time with offset, e.g. 2026-10-12T15:00:00-07:00."
            }
          },
          "required": [
            "dateTime"
          ]
        },
        "end": {
          "type": "object",
          "properties": {
            "dateTime": {
              "type": "string",
              "description": "RFC 3339 date-time with offset, e.g. 2026-10-12T15:00:00-07:00."
            }
          },
          "required": [
            "dateTime"
          ]
        },
        "attendees": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Full attendee list."
        },
        "addGoogleMeet": {
          "type": "boolean"
        }
      },
      "required": [
        "eventId"
      ]
    },
  },
  "calendar.respondToEvent": {
    description:
      "Responds to a meeting invitation (accept, decline, or tentative).",
    parameters: {
      "type": "object",
      "properties": {
        "eventId": {
          "type": "string",
          "description": "Event id."
        },
        "calendarId": {
          "type": "string",
          "description": "Calendar id; defaults to primary."
        },
        "responseStatus": {
          "type": "string",
          "enum": [
            "accepted",
            "declined",
            "tentative"
          ]
        },
        "responseMessage": {
          "type": "string",
          "description": "Optional note to the organizer."
        }
      },
      "required": [
        "eventId",
        "responseStatus"
      ]
    },
  },
  "gmail.search": {
    description: "Search for emails in Gmail using query parameters.",
    parameters: {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Gmail search query, same syntax as the Gmail search box (e.g. 'from:alex subject:invoice newer_than:7d')."
        },
        "maxResults": {
          "type": "number",
          "description": "Maximum messages to return."
        },
        "labelIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Only messages with all of these label ids (e.g. INBOX, UNREAD)."
        }
      }
    },
  },
  "gmail.get": {
    description: "Get the full content of a specific email message.",
    parameters: {
      "type": "object",
      "properties": {
        "messageId": {
          "type": "string",
          "description": "Gmail message id from gmail.search."
        },
        "format": {
          "type": "string",
          "enum": [
            "minimal",
            "full",
            "raw",
            "metadata"
          ],
          "description": "Defaults to full."
        }
      },
      "required": [
        "messageId"
      ]
    },
  },
  "gmail.downloadAttachment": {
    description: "Downloads an attachment from a Gmail message to a local file.",
    parameters: {
      "type": "object",
      "properties": {
        "messageId": {
          "type": "string",
          "description": "Message id."
        },
        "attachmentId": {
          "type": "string",
          "description": "Attachment id from gmail.get."
        },
        "localPath": {
          "type": "string",
          "description": "Absolute path to save the file to."
        }
      },
      "required": [
        "messageId",
        "attachmentId",
        "localPath"
      ]
    },
  },
  "gmail.modify": {
    description: "Modify labels on a Gmail message.",
    parameters: {
      "type": "object",
      "properties": {
        "messageId": {
          "type": "string",
          "description": "Message id."
        },
        "addLabelIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Label ids to add (e.g. a user label id, STARRED, IMPORTANT, UNREAD)."
        },
        "removeLabelIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Label ids to remove (e.g. INBOX to archive, UNREAD to mark read)."
        }
      },
      "required": [
        "messageId"
      ]
    },
  },
  "gmail.send": {
    description: "Send an email message.",
    parameters: {
      "type": "object",
      "properties": {
        "to": {
          "oneOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          ],
          "description": "Recipient address or addresses."
        },
        "subject": {
          "type": "string",
          "description": "Subject line."
        },
        "body": {
          "type": "string",
          "description": "Message body."
        },
        "cc": {
          "type": "string",
          "description": "Optional cc address."
        },
        "bcc": {
          "type": "string",
          "description": "Optional bcc address."
        },
        "isHtml": {
          "type": "boolean"
        }
      },
      "required": [
        "to",
        "subject",
        "body"
      ]
    },
  },
  "gmail.createDraft": {
    description: "Create a draft email message.",
    parameters: {
      "type": "object",
      "properties": {
        "to": {
          "oneOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          ],
          "description": "Recipient address or addresses."
        },
        "subject": {
          "type": "string",
          "description": "Subject line."
        },
        "body": {
          "type": "string",
          "description": "Message body."
        },
        "threadId": {
          "type": "string",
          "description": "Thread id to make the draft a reply in that thread."
        },
        "cc": {
          "type": "string",
          "description": "Optional cc."
        },
        "isHtml": {
          "type": "boolean"
        }
      },
      "required": [
        "to",
        "subject",
        "body"
      ]
    },
  },
  "gmail.sendDraft": {
    description: "Send a previously created draft email.",
    parameters: {
      "type": "object",
      "properties": {
        "draftId": {
          "type": "string",
          "description": "Draft id from gmail.createDraft."
        }
      },
      "required": [
        "draftId"
      ]
    },
  },
  "gmail.listLabels": {
    description: "List all Gmail labels in the user's mailbox.",
    parameters: { type: "object", properties: {} },
  },
  "gmail.createLabel": {
    description:
      "Create a new Gmail label. Labels help organize emails into categories.",
    parameters: {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "Label name."
        }
      },
      "required": [
        "name"
      ]
    },
  },
  "sheets.create": {
    description:
      "Creates a new Google Spreadsheet, optionally with named tabs. Returns the spreadsheetId and URL.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title for the new spreadsheet.",
        },
        sheetTitles: {
          type: "array",
          items: { type: "string" },
          description: "Optional tab titles to create in the spreadsheet.",
        },
      },
      required: ["title"],
    },
  },
  "sheets.getSpreadsheet": {
    description:
      "Gets spreadsheet metadata (title and tabs) for a spreadsheet id or URL.",
    parameters: {
      type: "object",
      properties: {
        spreadsheetId: {
          type: "string",
          description: "Spreadsheet id or full Google Sheets URL.",
        },
      },
      required: ["spreadsheetId"],
    },
  },
  "sheets.getValues": {
    description:
      "Reads cell values from an A1 range (e.g. 'Sheet1!A1:C10').",
    parameters: {
      type: "object",
      properties: {
        spreadsheetId: {
          type: "string",
          description: "Spreadsheet id or full Google Sheets URL.",
        },
        range: {
          type: "string",
          description: "A1 notation range, e.g. 'Sheet1!A1:C10'.",
        },
      },
      required: ["spreadsheetId", "range"],
    },
  },
  "sheets.updateValues": {
    description:
      "Writes a 2D array of values to an A1 range, overwriting existing cells.",
    parameters: {
      type: "object",
      properties: {
        spreadsheetId: {
          type: "string",
          description: "Spreadsheet id or full Google Sheets URL.",
        },
        range: {
          type: "string",
          description: "A1 notation range to write to, e.g. 'Sheet1!A1'.",
        },
        values: {
          type: "array",
          items: { type: "array" },
          description: "2D array of row values to write.",
        },
        valueInputOption: {
          type: "string",
          enum: ["RAW", "USER_ENTERED"],
          description:
            "How input is interpreted. Defaults to USER_ENTERED (parses formulas/dates).",
        },
      },
      required: ["spreadsheetId", "range", "values"],
    },
  },
  "sheets.appendValues": {
    description:
      "Appends rows after the last row of data within a range.",
    parameters: {
      type: "object",
      properties: {
        spreadsheetId: {
          type: "string",
          description: "Spreadsheet id or full Google Sheets URL.",
        },
        range: {
          type: "string",
          description: "A1 notation range identifying the table, e.g. 'Sheet1!A1'.",
        },
        values: {
          type: "array",
          items: { type: "array" },
          description: "2D array of row values to append.",
        },
        valueInputOption: {
          type: "string",
          enum: ["RAW", "USER_ENTERED"],
          description:
            "How input is interpreted. Defaults to USER_ENTERED.",
        },
      },
      required: ["spreadsheetId", "range", "values"],
    },
  },
  "sheets.addSheet": {
    description: "Adds a new tab (sheet) to an existing spreadsheet.",
    parameters: {
      type: "object",
      properties: {
        spreadsheetId: {
          type: "string",
          description: "Spreadsheet id or full Google Sheets URL.",
        },
        title: { type: "string", description: "Title for the new tab." },
      },
      required: ["spreadsheetId", "title"],
    },
  },
  "tasks.listTaskLists": {
    description: "Lists the user's Google Tasks task lists.",
    parameters: { type: "object", properties: {} },
  },
  "tasks.list": {
    description:
      "Lists tasks within a task list. Defaults to the primary list ('@default').",
    parameters: {
      type: "object",
      properties: {
        tasklist: {
          type: "string",
          description: "Task list id. Defaults to '@default'.",
        },
        showCompleted: {
          type: "boolean",
          description: "Include completed (hidden) tasks. Defaults to false.",
        },
      },
    },
  },
  "tasks.create": {
    description:
      "Creates a task in a task list. Defaults to the primary list ('@default').",
    parameters: {
      type: "object",
      properties: {
        tasklist: {
          type: "string",
          description: "Task list id. Defaults to '@default'.",
        },
        title: { type: "string", description: "Task title." },
        notes: { type: "string", description: "Optional task notes." },
        due: {
          type: "string",
          description: "Optional RFC 3339 due date (e.g. '2026-08-25T00:00:00.000Z').",
        },
      },
      required: ["title"],
    },
  },
  "tasks.update": {
    description:
      "Updates mutable fields of a task (title, notes, due, status).",
    parameters: {
      type: "object",
      properties: {
        tasklist: {
          type: "string",
          description: "Task list id. Defaults to '@default'.",
        },
        taskId: { type: "string", description: "Id of the task to update." },
        title: { type: "string", description: "New task title." },
        notes: { type: "string", description: "New task notes." },
        due: {
          type: "string",
          description: "New RFC 3339 due date.",
        },
        status: {
          type: "string",
          enum: ["needsAction", "completed"],
          description: "New task status.",
        },
      },
      required: ["taskId"],
    },
  },
  "tasks.complete": {
    description: "Marks a task as completed.",
    parameters: {
      type: "object",
      properties: {
        tasklist: {
          type: "string",
          description: "Task list id. Defaults to '@default'.",
        },
        taskId: { type: "string", description: "Id of the task to complete." },
      },
      required: ["taskId"],
    },
  },
  "gmail.modifyThread": {
    description: "Add or remove labels on every message in a Gmail thread: archive (remove INBOX), mark read (remove UNREAD), label, or move to Trash (add TRASH).",
    parameters: {
      "type": "object",
      "properties": {
        "threadId": {
          "type": "string",
          "description": "Thread id."
        },
        "addLabelIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Label ids to add to every message in the thread (TRASH moves the thread to Trash)."
        },
        "removeLabelIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Label ids to remove (INBOX to archive, UNREAD to mark read)."
        }
      },
      "required": [
        "threadId"
      ]
    },
  },
  "calendar.deleteEvent": {
    description: "Deletes an event from a calendar.",
    parameters: {
      "type": "object",
      "properties": {
        "eventId": {
          "type": "string",
          "description": "Event id."
        },
        "calendarId": {
          "type": "string",
          "description": "Calendar id; defaults to primary."
        }
      },
      "required": [
        "eventId"
      ]
    },
  },
  "drive.moveFile": {
    description: "Moves a Drive file into another folder.",
    parameters: {
      "type": "object",
      "properties": {
        "fileId": {
          "type": "string",
          "description": "Drive file id or URL."
        },
        "folderId": {
          "type": "string",
          "description": "Destination folder id."
        },
        "folderName": {
          "type": "string",
          "description": "Destination folder name, if the id is unknown."
        }
      },
      "required": [
        "fileId"
      ]
    },
  },
  "drive.trashFile": {
    description: "Moves a Drive file or folder to the Drive trash.",
    parameters: {
      "type": "object",
      "properties": {
        "fileId": {
          "type": "string",
          "description": "Drive file id or URL."
        }
      },
      "required": [
        "fileId"
      ]
    },
  },
  "time.getCurrentDate": {
    description:
      "Gets the current date. Returns both UTC and local time, along with the timezone.",
    parameters: { type: "object", properties: {} },
  },
  "time.getCurrentTime": {
    description:
      "Gets the current time. Returns both UTC and local time, along with the timezone.",
    parameters: { type: "object", properties: {} },
  },
  "time.getTimeZone": {
    description:
      "Gets the local timezone. Note: timezone is also included in getCurrentDate and getCurrentTime responses.",
    parameters: { type: "object", properties: {} },
  },
  "people.getMe": {
    description: "Gets the profile information of the authenticated user.",
    parameters: { type: "object", properties: {} },
  },
};
