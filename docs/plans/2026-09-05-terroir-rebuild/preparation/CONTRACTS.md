# Contract preparation: prose only, not migrations or code

Status SPECIFIED, NOT EXECUTED. D owns SQL/types; C/R/O consume only after contract landing.

M1: person identity; group; business owned by group; venue owned by business; actor grants scoped to business/venue plus a separate view_cost capability. Invitations select a fixed context for S. Define unauthenticated, invalid/expired/reused invite, tampered foreign context, revoked membership, cost-hidden and privileged cases. No implicit inventory pooling or group cost authority. Scope selection never creates authority.

M2: approved producer/wine/release/package identifiers; unknown vintage separate from NV; exact positive quantity/volume and currency-qualified money. Receipt command binds actor, authorized business/venue, package, quantity, cost visibility/entry capability, source reference and an operation key to a canonical payload hash. Repeated same key/payload returns original result; same key/different payload conflicts. Atomic receipt/event/balance and immutable attributed reversal plus replacement preserve conservation. Define lock order and transaction-time grant check; rollback after any injected failure leaves no partial effect. Unauthorized direct table writes fail; SECURITY DEFINER/service-role capabilities are enumerated and bounded.

V1/V2: candidate host/routes cannot call legacy stock adapters; private costs are omitted in server/SQL projections without capability. Lookup searches only approved picklist fields with stable ID and bounded pagination. Ambiguous/unsupported product receives a useful refusal; no model guesses an identity. Typed manual review precedes confirm. Refresh/reopen and mobile error/retry states use actual persisted data.

V3/V4: scoped CSV includes evaluation status and never exposes hidden costs; revoke/pause checked at mutation execution; recovery retains all acknowledged receipts. Candidate Auth/config/database backup and any selected object bytes are restored and reconciled in approved same-region boundaries. No pilot attachments in S. Capture counts/hashes/FKs/currency balances and approved source/rights manifest, never publish private evidence.

Future only: CountObservation, ConsumptionReconciliation, PublicWineView/Publication and JobEnvelope remain documented contract intentions until an approved consumer exists. No unused runtime interface or unnumbered SQL draft is part of this package.
