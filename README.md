# mail-assistant

Personal IMAP/SMTP mailbox exposed to Claude as a remote MCP server (custom connector), in the same way as `telegram-assistant`.

**Tools:** `get_access`, `list_folders`, `search_messages`, `read_message` (does not mark as read), `create_draft` (saves to Drafts, sends nothing), `move_to_trash` (moves explicit uids to Trash, never deletes permanently; on unless `MAIL_TRASH_ENABLED=false`), and `send_message` only when `MAIL_SENDING_ENABLED=true`.

**Safety:** `send_message` needs the digest of the exact draft (to, cc, subject, text), a `userRequestId` (the same request is never sent twice, an unknown SMTP outcome is never retried) and respects `MAIL_DAILY_SEND_LIMIT`. CR/LF in headers is rejected. `move_to_trash` takes 1-10 explicit uids from one folder (no ranges or wildcards), uses IMAP `UID MOVE`, falls back to `UID COPY` + `UID EXPUNGE` of those uids only after the copy succeeded, and refuses servers that offer neither (a plain `EXPUNGE` could remove other messages). Mail content is untrusted data. Server errors are never echoed to the client.

## Configuration (Render environment variables)
| Variable | Notes |
|---|---|
| `MAIL_USER`, `MAIL_PASS` | Mailbox login; use an app password if the provider offers one |
| `MCP_API_TOKEN` | 32+ chars; the value of the connector's `x-api-key` header |
| `IMAP_HOST`/`IMAP_PORT`, `SMTP_HOST`/`SMTP_PORT` | Default `mail.runbox.com` 993 / 465 (implicit TLS) |
| `MAIL_FROM` | Optional, defaults to `MAIL_USER` |
| `UNIPILE_DSN`, `UNIPILE_API_KEY`, `UNIPILE_ACCOUNTS` | Optional. `UNIPILE_ACCOUNTS=natanh@runbox.com=<account_id>`: mail with that `from` goes out through Unipile (`POST /api/v1/emails`, with `from` set to the alias) using the linked mailbox account, instead of SMTP. Listed addresses become allowed senders |
| `MAIL_SENDER_NAMES` | Optional display names, `natanh@runbox.com=Natan Horwitz` (this one is the built-in default) |
| `MAIL_ALIASES` | Optional extra allowed `from` addresses sent through the normal SMTP login |
| `MAIL_SENDING_ENABLED` | Default `false` |
| `MAIL_TRASH_ENABLED` | Default on; `false` hides `move_to_trash` |
| `MAIL_DAILY_SEND_LIMIT` | Default 50 |

Connector in claude.ai: URL `https://<service>.onrender.com/mcp`, no sign-in, header `x-api-key`. Deploys are manual (`autoDeployTrigger: "off"`).
