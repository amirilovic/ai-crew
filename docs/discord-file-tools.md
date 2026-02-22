# Discord File Tools

This document describes the Discord file attachment tools available to agents.

## Overview

Agents can now receive and send files/images through Discord, enabling richer communication:
- **Receive**: Screenshots, design mockups, log files, code snippets
- **Send**: Generated reports, diagrams, code files, data exports

## Tools

### discord_read_channel (enhanced)

Messages now include full attachment data:

```typescript
{
  messages: [{
    id: "123",
    content: "Here's the screenshot",
    attachments: [{
      id: "456789",
      filename: "screenshot.png",
      url: "https://cdn.discordapp.com/attachments/...",
      contentType: "image/png",
      size: 102400
    }]
  }]
}
```

### discord_download_attachment

Download attachment content from Discord CDN.

**Parameters:**
- `url` (required): The Discord CDN URL of the attachment
- `asBase64` (optional, default: false): Force base64 encoding for all files

**Returns:**
- Text files: Content as plain text
- Binary files: Content as base64-encoded string

**Example:**
```typescript
// Download a text file
const result = await discord_download_attachment({
  url: "https://cdn.discordapp.com/attachments/.../config.json"
});
// Returns: { success: true, encoding: "text", content: "{...}", contentType: "application/json" }

// Download an image
const image = await discord_download_attachment({
  url: "https://cdn.discordapp.com/attachments/.../image.png"
});
// Returns: { success: true, encoding: "base64", content: "iVBORw0KGgo...", contentType: "image/png" }
```

### discord_send_file

Upload and send a file to a Discord channel.

**Parameters:**
- `channel` (required): Channel name or ID
- `filePath` (required): Absolute path to the file to upload
- `caption` (optional): Message to send with the file

**Limits:**
- Maximum file size: 8MB (Discord limit)

**Example:**
```typescript
// Send a log file
await discord_send_file({
  channel: "dev-chat",
  filePath: "/tmp/debug.log",
  caption: "Here's the debug log from the failed build"
});

// Send an image
await discord_send_file({
  channel: "development",
  filePath: "/tmp/screenshot.png",
  caption: "Screenshot of the bug"
});
```

## Supported File Types

### Text files (returned as text)
- Plain text (.txt)
- JSON (.json)
- JavaScript/TypeScript (.js, .ts)
- XML (.xml)
- YAML (.yaml, .yml)
- Markdown (.md)
- Code files

### Binary files (returned as base64)
- Images (.png, .jpg, .gif, .webp)
- PDFs (.pdf)
- Archives (.zip, .tar.gz)
- Other binary formats

## Error Handling

Both tools return error objects on failure:

```typescript
// File not found
{ error: "Failed to download attachment: 404 Not Found" }

// File too large
{ error: "File size (10.5MB) exceeds Discord's 8MB limit" }

// Channel not found
{ error: "Channel \"invalid-channel\" not found" }
```

## Use Cases

### Bug Reports with Screenshots
```
User: [uploads screenshot] "The button is broken"
Agent: Downloads image, analyzes, creates ticket with attachment
```

### Code Review
```
User: [uploads code file] "Review this please"
Agent: Downloads file, reads content, provides feedback
```

### Sharing Results
```
Agent: Generates test report, uploads to channel
"Here's the test report: [attachment]"
```

### Log Analysis
```
User: [uploads log file] "Why did the build fail?"
Agent: Downloads log, analyzes errors, explains issue
```
