# Subscription Tracking Agent

An AI-powered subscription tracker designed to scan Gmail invoices, receipts, and renewal notices to discover and monitor recurring subscriptions.

## Project Status

This project is currently in the planning and design phase. The repository contains an AI-assisted development playbook that covers architecture, implementation, testing, security review, scalability, and release readiness.

## Planned Capabilities

- Connect to Gmail with read-only OAuth access
- Detect subscriptions from confirmations, receipts, and renewal notices
- Extract vendors, prices, currencies, billing cycles, and renewal dates
- Track subscription lifecycle and payment history
- Detect duplicate records and price increases
- Alert users before renewals
- Identify potentially unused subscriptions
- Provide subscription reports and notifications

## Proposed Stack

- Next.js and TypeScript
- PostgreSQL and Prisma
- Gmail API
- OpenAI-compatible language model provider
- Background job processing

## Development Roadmap

1. Define requirements and system architecture.
2. Design the data model and processing workflows.
3. Scaffold the application and infrastructure.
4. Implement secure Gmail synchronization.
5. Build and validate the subscription extraction pipeline.
6. Add persistence, history, renewals, and audit logging.
7. Create unit, integration, end-to-end, and adversarial tests.
8. Complete security, engineering, scalability, and release reviews.

## Development Playbook

See [subscription-tracking-agent-prompts.md](subscription-tracking-agent-prompts.md) for the prompts and review stages used throughout the planned development lifecycle.

## Security and Privacy

The implementation should request the minimum Gmail permissions required, encrypt stored credentials, avoid logging sensitive email content, defend against prompt injection in untrusted messages, and define clear data retention and deletion policies before production use.
