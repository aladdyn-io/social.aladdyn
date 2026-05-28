# Requirements Document

## Introduction

The Regeneration Token System adds a per-campaign credit mechanism that limits how many times users can regenerate images or videos for posts within a Social Aladdyn campaign. Each campaign receives 3 free tokens on creation. Tokens are consumed on every successful regeneration (image or video) and refunded automatically when generation fails. An admin endpoint allows granting additional tokens up to a hard cap of 10. The system must be race-condition-safe and maintain a full audit trail of every token transaction.

## Glossary

- **Token_Ledger**: The PostgreSQL table (`campaign_token_ledgers`) that stores the current token balance for a campaign.
- **Token_Transaction**: A single record in the `campaign_token_transactions` table representing one credit or debit event.
- **Token_Service**: The TypeScript service module responsible for all token balance reads, debits, refunds, and grants.
- **Campaign**: A `SocialCampaign` record in the `social` schema.
- **Post**: A `SocialPost` record belonging to a Campaign.
- **Regeneration**: A user-initiated call to `POST /api/v1/posts/:postId/generate-image` or `POST /api/v1/posts/:postId/generate-video`.
- **Token_Cap**: The maximum number of tokens a campaign may hold at any time (10).
- **Initial_Grant**: The 3 tokens automatically credited when a Campaign is created.
- **Admin**: A caller authenticated with admin-level privileges who may invoke the grant endpoint.
- **Atomic_Debit**: A balance check and decrement executed inside a single serializable database transaction so concurrent requests cannot both succeed when only 1 token remains.

---

## Requirements

### Requirement 1: Token Ledger Initialization

**User Story:** As a campaign owner, I want my campaign to start with 3 free regeneration tokens automatically, so that I can immediately regenerate posts without any manual setup.

#### Acceptance Criteria

1. WHEN a new Campaign is created, THE Token_Service SHALL create a Token_Ledger record for that Campaign with a balance of 3.
2. WHEN a new Campaign is created, THE Token_Service SHALL record a `INITIAL_GRANT` Token_Transaction with an amount of 3 and a description of "Initial free tokens".
3. IF a Token_Ledger record already exists for a Campaign at creation time, THEN THE Token_Service SHALL skip both the ledger creation and the initial grant Token_Transaction recording.
4. THE Token_Ledger SHALL store the campaignId, current balance, and timestamps for createdAt and updatedAt.

---

### Requirement 2: Token Balance Query

**User Story:** As a campaign owner, I want to view my current token balance and full transaction history, so that I can understand how many regenerations I have left and how tokens were used.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/v1/campaigns/:campaignId/tokens`, THE Token_Service SHALL return the current balance and the complete list of Token_Transactions for that Campaign in descending createdAt order.
2. WHEN the campaignId does not correspond to an existing Campaign, THE Token_Service SHALL return HTTP 404 with a descriptive error message.
3. THE Token_Service SHALL include the following fields in each Token_Transaction response: `id`, `campaignId`, `type`, `amount`, `balanceAfter`, `description`, `postId` (nullable), and `createdAt`.
4. WHILE a Campaign exists, THE Token_Service SHALL return a balance of 0 or greater in the response.

---

### Requirement 3: Atomic Token Debit on Regeneration

**User Story:** As a campaign owner, I want the system to check and deduct a token before each regeneration attempt, so that I cannot exceed my token allowance even under concurrent requests.

#### Acceptance Criteria

1. WHEN a Regeneration request is received for a Post, THE Token_Service SHALL perform an Atomic_Debit that checks the balance and decrements it by 1 within a single serializable database transaction.
2. WHEN the Token_Ledger balance is 0 at the time of the Atomic_Debit, THE Token_Service SHALL abort the debit and return HTTP 402 with the message "Insufficient regeneration tokens".
3. WHEN the Atomic_Debit succeeds, THE Token_Service SHALL record a `DEBIT` Token_Transaction with amount 1, the postId, and a description of "Regeneration debit".
4. WHEN two concurrent Regeneration requests arrive for the same Campaign with exactly 1 token remaining, THE Token_Service SHALL allow exactly one request to proceed (debiting exactly 1 token) and return HTTP 402 for the other.
5. THE Token_Ledger balance SHALL never fall below 0 as a result of any Atomic_Debit operation.

---

### Requirement 4: Automatic Token Refund on Generation Failure

**User Story:** As a campaign owner, I want my token automatically refunded when a regeneration fails, so that I am not penalized for system errors or transient failures.

#### Acceptance Criteria

1. WHEN a Regeneration throws an unhandled error after a successful Atomic_Debit, THE Token_Service SHALL credit 1 token back to the Token_Ledger for that Campaign.
2. WHEN a refund is issued, THE Token_Service SHALL record a `REFUND` Token_Transaction with amount 1, the postId, and a description of "Refund: generation failed".
3. WHEN a Regeneration completes successfully (including fallback image for a video slot), THE Token_Service SHALL NOT issue a refund.
4. IF a refund operation itself fails, THEN THE Token_Service SHALL log the failure with the campaignId, postId, and error details so that the discrepancy can be resolved manually. IF the logging also fails, THEN THE Token_Service SHALL accept the logging failure and leave the user without their refunded token until manual resolution.
5. WHEN a refund is applied, THE Token_Ledger balance after the refund SHALL equal the balance before the debit.

---

### Requirement 5: Admin Token Grant

**User Story:** As an admin, I want to grant additional tokens to a campaign up to the cap, so that users who need more regenerations can receive them without exceeding the system limit.

#### Acceptance Criteria

1. WHEN a POST request is made to `/api/v1/campaigns/:campaignId/tokens/grant` with a valid `amount` in the request body, THE Token_Service SHALL add the specified amount to the Token_Ledger balance, provided the resulting balance does not exceed the Token_Cap of 10.
2. WHEN the resulting balance would exceed the Token_Cap of 10, THE Token_Service SHALL refuse the grant entirely and return HTTP 422 with a message indicating the maximum grantable amount.
3. WHEN the grant is applied, THE Token_Service SHALL record a `GRANT` Token_Transaction with the actual credited amount and a description of "Admin token grant".
4. WHEN the campaignId does not correspond to an existing Campaign, THE Token_Service SHALL return HTTP 404.
5. WHEN the `amount` in the request body is not a positive integer, THE Token_Service SHALL return HTTP 400 with a descriptive validation error.
6. WHEN a non-admin caller invokes the grant endpoint, THE Token_Service SHALL return HTTP 403.
7. THE Token_Ledger balance SHALL never exceed the Token_Cap of 10 as a result of any grant operation.

---

### Requirement 6: Token Balance Persistence and Audit Trail

**User Story:** As a system operator, I want every token event persisted with a full audit trail, so that I can reconstruct the exact balance history for any campaign at any point in time.

#### Acceptance Criteria

1. THE Token_Service SHALL always persist every debit, refund, and grant as a Token_Transaction record in PostgreSQL before returning a response to the caller.
2. THE Token_Transaction record SHALL include a `balanceAfter` field that captures the Token_Ledger balance immediately after the transaction was applied.
3. THE Token_Service SHALL store Token_Ledger and Token_Transaction records in the `social` PostgreSQL schema, consistent with the existing Prisma schema conventions.
4. WHEN the Token_Ledger is queried, THE Token_Service SHALL return a balance consistent with replaying all Token_Transactions for that Campaign in chronological order.

---

### Requirement 7: HTTP 402 Response on Insufficient Tokens

**User Story:** As a frontend developer, I want the generate-image and generate-video endpoints to return HTTP 402 when tokens are exhausted, so that the UI can display a clear "out of tokens" message to the user.

#### Acceptance Criteria

1. WHEN a Regeneration request is received and the Token_Ledger balance is 0, THE Token_Service SHALL return HTTP 402 with a JSON body containing `{ "error": "INSUFFICIENT_TOKENS", "message": "Insufficient regeneration tokens", "balance": 0 }`.
2. WHEN HTTP 402 is returned, THE Token_Service SHALL NOT debit any token and SHALL NOT invoke the image or video generation pipeline.
3. WHEN HTTP 402 is returned, THE Token_Service SHALL include the current balance in the response body so the client can display it.

---

### Requirement 8: Correctness Properties for Property-Based Testing

**User Story:** As a developer, I want the token system to satisfy formal correctness properties, so that edge cases and concurrent scenarios are caught by automated tests.

#### Acceptance Criteria

1. FOR ALL sequences of debit and refund operations on a Token_Ledger, THE Token_Service SHALL maintain a balance greater than or equal to 0 at all times (balance non-negativity invariant).
2. FOR ALL sequences of grant and debit operations on a Token_Ledger, THE Token_Service SHALL maintain a balance less than or equal to 10 at all times (balance cap invariant).
3. FOR ALL debit operations that succeed, THE Token_Service SHALL produce exactly one corresponding `DEBIT` Token_Transaction record (debit-transaction correspondence invariant).
4. FOR ALL refund operations, THE Token_Service SHALL restore the balance to exactly the value it held before the corresponding debit (exact refund invariant).
5. WHEN a sequence of grant operations is applied to a Token_Ledger, THE Token_Service SHALL produce the same final balance regardless of the order in which the grants are applied, provided the total does not exceed the cap (grant commutativity property).
6. WHEN a debit is followed immediately by a refund for the same post, THE Token_Service SHALL produce a net balance change of 0 (debit-refund round-trip property).
