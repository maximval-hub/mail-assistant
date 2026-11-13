# mail-assistant

Personal IMAP/SMTP mailbox exposed to Claude as a remote MCP server (custom connector), in the same way as `telegram-assistant`.

**Tools:** `get_access`, `list_folders`, `search_messages`, `read_message` (does not mark as read), `create_draft` (saves to Drafts, sends nothing; optional `from` picks an allowed sender alias), and `send_message` only when `MAIL_SENDING_ENABLED=true`.

**Safety:** `send_message` needs the digest of the exact draft (from, to, cc, subject, text), a `userRequestId` (the same request is never sent twice, an unknown SMTP outcome is never retried) and respects `MAIL_DAILY_SEND_LIMIT`. CR/LF in headers is rejected. Mail content is untrusted data. Server errors are never echoed to the client.

## Configuration (Render environment variables)
| Variable | Notes |
|---|---|
| `MAIL_USER`, `MAIL_PASS` | Mailbox login; use an app password if the provider offers one |
| `MCP_API_TOKEN` | 32+ chars; the value of the connector's `x-api-key` header |
| `IMAP_HOST`/`IMAP_PORT`, `SMTP_HOST`/`SMTP_PORT` | Default `mail.runbox.com` 993 / 465 (implicit TLS) |
| `MAIL_FROM` | Optional default sender, `addr` or `Name <addr>`; defaults to `MAIL_USER` |
| `MAIL_ALLOWED_FROM` | Optional extra senders (aliases of the same account), comma-separated, each `addr` or `Name <addr>`. Only these and the default can appear in From; `get_access` lists them |
| `MAIL_SENDING_ENABLED` | Default `false` |
| `MAIL_DAILY_SEND_LIMIT` | Default 50 |

Connector in claude.ai: URL `https://<service>.onrender.com/mcp`, no sign-in, header `x-api-key`. Deploys are manual (`autoDeployTrigger: "off"`).
