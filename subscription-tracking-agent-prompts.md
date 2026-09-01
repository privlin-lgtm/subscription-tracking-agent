# AI Development Prompts

This document contains the prompts used throughout the development lifecycle of the Subscription Tracker Agent. Follow the stages in order and use the recommended tool for each phase.

---

## Project Overview

Build an AI-powered subscription tracking agent that:

- Connects to Gmail
- Detects subscription-related emails
- Extracts billing information
- Tracks recurring subscriptions
- Monitors renewals
- Detects price increases
- Identifies potentially unused subscriptions
- Provides reporting and notifications

---

## Phase 1: Requirements & Architecture

> Tool: Claude

### Initial Architecture Design

```text
You are a senior AI systems architect.

I want to build a subscription tracking agent.

Data source:
- Gmail inbox
- Subscription confirmation emails
- Renewal notices
- Payment receipts

Core capabilities:
- Detect subscriptions automatically
- Extract vendor, price, currency, billing cycle, next renewal date
- Track subscription lifecycle
- Alert me before renewals
- Detect price increases
- Identify inactive subscriptions

Please create:

1. System architecture
2. Data model
3. Agent workflow
4. Required APIs
5. Failure cases
6. Security considerations
7. MVP scope
8. Future roadmap

Output the design as a technical specification.
```

---

### Architecture Review

> Tool: Claude

```text
Act as a principal engineer reviewing this design.

Find:
- Missing requirements
- Security risks
- Scalability problems
- Data quality issues
- Gmail API limitations
- Cost considerations

Provide a severity rating for each issue.
```

---

## Phase 2: Technical Design

> Tool: Claude

```text
Using the approved architecture, generate:

- Database schema
- Gmail processing workflow
- Subscription extraction pipeline
- State machine for subscription lifecycle
- Alert scheduling mechanism
- Entity extraction strategy

Include diagrams in Mermaid format.
```

---

## Phase 3: Project Scaffolding

> Tool: Cursor

```text
Create a production-ready subscription tracking system.

Tech stack:
- Next.js
- TypeScript
- PostgreSQL
- Prisma
- Gmail API
- OpenAI-compatible LLM provider
- Background jobs

Generate:
- Folder structure
- Prisma models
- API routes
- Authentication
- Gmail integration layer
- Subscription service layer
- Unit test framework

Follow clean architecture principles.
```

---

## Phase 4: Gmail Integration

> Tool: Cursor

```text
Implement Gmail OAuth integration.

Requirements:
- Read-only Gmail access
- Store refresh tokens securely
- Incremental email synchronization
- Handle Gmail rate limits
- Process only relevant messages

Generate production-quality code and tests.
```

---

### Gmail Integration Review

> Tool: Claude

```text
Review this Gmail integration implementation.

Focus on:
- OAuth security
- Token storage
- Rate limit handling
- Error recovery
- Privacy concerns

Suggest improvements and provide example patches.
```

---

## Phase 5: Subscription Detection Agent

### Design Phase

> Tool: Claude

```text
Design a robust subscription detection agent.

Input:
- Email subject
- Sender
- Body content

Tasks:
- Identify subscription services
- Extract billing information
- Extract renewal dates
- Estimate confidence score

Provide prompts, extraction schema, and validation rules.
```

---

### Implementation Phase

> Tool: Cursor

```text
Implement the subscription extraction pipeline.

Requirements:
- Confidence scoring
- Structured JSON output
- Vendor normalization
- Duplicate detection
- Currency normalization
- Renewal date extraction

Generate code, tests, and example fixtures.
```

---

### Validation Phase

> Tool: Claude

```text
Review the subscription extraction design.

Check:
- Accuracy of vendor detection
- False positive risks
- False negative risks
- Handling of international billing
- Currency conversion concerns
- Subscription lifecycle edge cases

Provide recommendations and confidence levels.
```

---

## Phase 6: Database Layer

> Tool: Cursor

```text
Implement subscription persistence layer.

Features:
- CRUD operations
- Subscription history
- Renewal tracking
- Price change tracking
- Audit logs

Use Prisma and PostgreSQL.
```

---

### Database Review

> Tool: Claude

```text
Review this database design.

Evaluate:
- Normalization
- Scalability
- Query performance
- Historical tracking
- Data retention strategy
- Auditing capabilities

Provide schema improvements if needed.
```

---

## Phase 7: Testing

### Unit Tests

> Tool: Cursor

```text
Generate comprehensive unit tests.

Coverage:
- Gmail parsing
- Subscription detection
- Date extraction
- Currency extraction
- Duplicate handling
- Alert generation

Target 90% coverage.
```

---

### Integration Tests

> Tool: Cursor

```text
Create integration tests covering:

- Gmail synchronization
- New subscription creation
- Renewal detection
- Price update detection
- Subscription cancellation
- Alert generation

Generate realistic test fixtures.
```

---

### End-to-End Tests

> Tool: Cursor

```text
Create end-to-end tests covering:

- New subscription email
- Renewal email
- Cancellation email
- Trial upgrade
- Price increase
- Duplicate receipt
- Gmail synchronization failure

Generate test data and assertions.
```

---

### Adversarial Testing

> Tool: Claude

```text
Act as a QA engineer.

Generate 100 difficult email examples that may break the subscription detector.

Include:
- Ambiguous invoices
- Trial subscriptions
- International currencies
- Mixed languages
- Changed pricing models
- Partial renewal notices

For each example provide expected output.
```

---

### Data Quality Validation

> Tool: Claude

```text
Review the extraction results.

Check:
- Incorrect vendor matches
- Duplicate subscriptions
- Missing renewals
- Invalid dates
- Currency inconsistencies

Provide a detailed error analysis report.
```

---

## Phase 8: Security Review

> Tool: Claude

```text
Perform a security review.

Evaluate:
- OAuth implementation
- Stored credentials
- Prompt injection risks in emails
- Sensitive data exposure
- Logging practices
- Data retention

Provide a risk matrix with severity scores.
```

---

### Prompt Injection Testing

> Tool: Claude

```text
Generate examples of malicious emails designed to manipulate the AI extraction process.

Include:
- Prompt injections
- Jailbreak attempts
- Hidden instructions
- HTML-based attacks
- Embedded content attacks

Explain how the system should defend against each attack.
```

---

## Phase 9: Engineering Review

> Tool: Claude

```text
Act as a principal engineer.

Review this implementation.

Check:
- Maintainability
- Performance
- Security
- Reliability
- Test coverage
- Architecture alignment

Output:

1. Critical issues
2. Major issues
3. Minor issues
4. Refactoring suggestions
5. Release recommendation
```

---

## Phase 10: Scalability Review

> Tool: Claude

```text
Assume the system will be used by 10,000 users.

Review:

- Architecture
- Reliability
- Scaling strategy
- Database load
- Gmail API quotas
- Cost model
- Background processing design

Identify launch blockers and propose solutions.
```

---

## Phase 11: Pre-Release Audit

> Tool: Claude — Pre-Release Audit

```text
Act as a CTO preparing this product for production release.

Review:

- Architecture
- Code quality
- Infrastructure
- Security
- Monitoring
- Alerting
- Disaster recovery
- Compliance
- Privacy

Produce a Go / No-Go recommendation.

List all launch blockers and required fixes.
```

---

## Recommended Workflow

```text
Claude
   ↓
Architecture & Design

Claude
   ↓
Architecture Validation

Cursor
   ↓
Implementation

Copilot
   ↓
Code Assistance

Claude
   ↓
Code Review

Cursor
   ↓
Apply Fixes

Claude
   ↓
Security Review

Cursor
   ↓
Testing

Claude
   ↓
Release Sign-Off
```

---

## Repository Description

```text
AI-powered subscription tracker that scans Gmail invoices and receipts to automatically discover, monitor, and analyze recurring subscriptions.
```
