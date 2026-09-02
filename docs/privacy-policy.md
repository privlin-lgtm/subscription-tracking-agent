# Privacy Policy

*Drafted per the recommendation in [Phase 11 — Pre-Release Audit](phase11-pre-release-audit.md), which found that the technical mechanisms (minimal OAuth scope, encrypted credentials, working account deletion) were sound but that no user-facing privacy policy existed, and flagged that gap as "outside this repository's scope to write" from an engineering standpoint.*

> **This is an engineering-authored first draft, not a legal document yet.** It was written directly from the current codebase (schema, config, and data flows) so that every claim below is accurate to what the product actually does today. It has **not** been reviewed by a lawyer, and it is missing information only the business can supply — legal entity name, jurisdiction, hosting provider, and a real contact address (all marked `[TODO: ...]` below). Do not publish this until a qualified legal reviewer has signed off, per the Phase 11 recommendation ("Get a legal/privacy review of user-facing policy language").

**Last updated:** `[TODO: date of legal sign-off]`

---

## 1. Who this policy covers

This Privacy Policy explains how `[TODO: legal entity / product name]` ("we", "us", the "Service") collects, uses, stores, and protects information when you use the subscription-tracking application (the "App"). It applies to anyone who creates an account, whether or not you connect Gmail.

## 2. What we collect

### 2.1 Account information
- **Email address** — used as your login identifier and to identify your account.
- **Password** — if you sign up with a password, we store a salted hash of it (bcrypt), never the password itself.

### 2.2 Gmail access (optional, only if you connect it)
If you choose to connect Gmail, we request Google's `gmail.readonly` OAuth scope — the minimum permission needed to read (not send, delete, or modify) your mail. We do not request access to any other Google service.

- We store an encrypted **refresh token** (AES-256-GCM, a key kept separate from other application secrets) so the App can keep syncing without asking you to re-authenticate.
- We store Gmail's internal sync cursor (`historyId`) so we only fetch new mail, not your whole inbox, on every sync.
- You can disconnect Gmail at any time from Settings; this revokes our stored token and stops all further mail access.

### 2.3 What we do with your email content
When Gmail is connected, the App scans incoming mail for anything that looks like a subscription, receipt, invoice, renewal, price-change, or cancellation notice.

- **Every message we look at** is recorded as a processed-email entry (Gmail's message ID, a sync cursor, and a classification — subscription / not-subscription / ambiguous) so we don't re-process the same message twice. This record does **not** include the email's content.
- **Messages classified as subscription-related** are sent to an AI/LLM extraction service to pull out structured data (vendor name, price, currency, billing cycle, renewal date, and whether the message is a cancellation). Only the subject line, sender address, and up to the first 8,000 characters of the message body are sent for this purpose — see [§4, Third parties](#4-third-party-service-providers) below for who that provider is.
- **A temporary snapshot** of the subject, sender, and body text of subscription-related messages is stored so the record can be reviewed or corrected later. This snapshot is automatically and permanently deleted after `[TODO: confirm production value]` days (30 days in the current default configuration) — we do not keep your raw email content indefinitely.
- Email content is always treated as untrusted data, not as instructions: the extraction step cannot take actions on your account, send mail, or render raw HTML back to you.

### 2.4 Subscription data we derive
From the mail we process (or from information you enter or confirm yourself), we build and store:
- Subscription records: vendor name, price, currency, billing cycle, status (active/canceled/inactive/pending review), and next renewal date.
- A history of events per subscription (created, renewed, price-changed, canceled, flagged inactive, reactivated, and your review decisions) and a history of price changes over time. **This historical record is kept permanently for as long as your account exists** — it's the product's core value (your subscription history), not a diagnostic log — and is deleted only when you delete your account (see §6).
- In-app notifications we generate for you (renewal reminders, price-increase alerts, inactivity flags, review prompts, and Gmail-disconnect notices). These are shown in the App only; we do not currently send this information by email or any other channel.
- A system-level audit log of account and sync activity, used for diagnostics and abuse investigation. Unlike your subscription history, this log is automatically purged after a rolling window (180 days by default, configurable) — it is not part of your permanent record.

### 2.5 What we do not collect
We do not use analytics or advertising trackers, we do not sell or rent your data, and we do not share your data with data brokers. We do not request write, send, or delete access to your mailbox — only read access, and only to the extent described above.

## 3. Why we process this information

We rely on the following legal bases (relevant if you are in the EEA/UK; for everyone else, this is simply why we do it):
- **Performance of a contract with you** — to provide the core service: detecting, tracking, and alerting you about your subscriptions.
- **Your consent** — connecting Gmail is optional and requires you to explicitly authorize it through Google's own consent screen; you can withdraw that consent at any time.
- **Legitimate interests** — maintaining audit logs for security and abuse prevention, in a way that is time-limited and proportionate.

## 4. Third-party service providers

We use a small number of subprocessors to operate the Service. We don't sell your data to any of them; they process it only to provide the service we've contracted them for.

| Provider | What they receive | Purpose |
|---|---|---|
| Google (Gmail API) | OAuth authorization; read-only access to mail you've connected | Letting the App read your inbox to detect subscriptions |
| `[TODO: name the actual LLM provider you deploy with — the code defaults to OpenAI (api.openai.com), but LLM_BASE_URL is configurable]` | Subject line, sender address, and up to 8,000 characters of body text from messages classified as subscription-related | Extracting structured subscription data (vendor, price, dates) from the message text |
| `[TODO: name your database/hosting provider]` | All account and subscription data described in §2 | Hosting the application database |

If you change or self-host the LLM endpoint (`LLM_BASE_URL`), update this table to reflect the actual provider before publishing, since that provider's own data-handling terms apply to the email content sent to it.

## 5. How we protect your data

- Gmail refresh tokens are encrypted at rest with AES-256-GCM under a dedicated encryption key, separate from the key used to sign your session.
- Passwords are hashed (bcrypt), never stored in plain text.
- The OAuth connection flow uses a short-lived, `httpOnly`, `secure` cookie scoped only to the connection endpoint.
- Access to your data within the App is scoped to your account; there is no cross-account data sharing.

No method of storage or transmission is 100% secure, and we can't guarantee absolute security — but we've scoped every credential and permission to the minimum the App needs to function.

## 6. Your rights and choices

- **Access and correction** — you can view and edit your subscription data directly in the App.
- **Disconnecting Gmail** — available anytime in Settings; this stops all further mail access and deletes the stored token.
- **Account deletion** — available anytime in Settings (a two-step confirmation). Deleting your account permanently and immediately deletes your account and everything tied to it: subscriptions, event history, price-change history, processed-email records, email snapshots, review decisions, notifications, and audit logs. This isn't a soft delete — the data is gone, not just hidden, and this action can't be undone.
- **If you are in the EEA/UK/similar jurisdictions**, you have rights under GDPR (or your local equivalent) to access, rectify, erase, restrict, or port your data, and to object to our processing. Account deletion above satisfies the right to erasure (Article 17) directly; for any other request, contact us using the details in §9.
- **If you are a California resident**, you may have rights under the CCPA/CPRA to know, delete, and opt out of the sale of your personal information. We do not sell personal information, so there is nothing to opt out of; the deletion right is satisfied by account deletion above.

## 7. Data retention summary

| Data | Retention |
|---|---|
| Account, subscriptions, event history, price-change history, review decisions, notifications | Kept for the life of your account; deleted immediately and permanently on account deletion |
| Raw email snapshots (subject/sender/body of subscription-related mail) | Auto-deleted after `[TODO: confirm value]` days (30-day default), regardless of account deletion timing |
| Processed-email log (message ID + classification only, no content) | Kept for the life of your account |
| System audit log | Auto-deleted on a rolling `[TODO: confirm value]`-day window (180-day default) |

## 8. Children's privacy

The Service is not directed at children under `[TODO: 13 in the US / 16 in the EEA, or your chosen age]`, and we do not knowingly collect personal information from them.

## 9. Contact us

`[TODO: real contact email/address for privacy requests — required before publishing]`

## 10. Changes to this policy

We may update this policy as the Service changes. `[TODO: describe how you'll notify users of material changes — e.g. email notice or in-app banner]`. The "Last updated" date at the top of this page reflects the most recent revision.

---

*Engineering note (remove before publishing): this draft was generated from `prisma/schema.prisma`, `src/infrastructure/llm/openai-compatible.extractor.ts`, `.env.example`, and the Phase 6/8/11 review documents in this folder, so the data-handling descriptions above should stay accurate as long as the code doesn't drift from them. If the schema or the LLM integration changes, this document needs a corresponding update — nothing here is copied from a generic template.*
