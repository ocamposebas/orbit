# Merchant statements

ORBIT statements are immutable monthly snapshots of the connected Stripe account balance ledger. The reporting layer does not change PaymentIntent creation, application fees, payouts, commerce integrations, or webhook processing.

## Recognition and reconciliation

The configured IANA timezone defines calendar-month boundaries. Stripe balance transactions are selected by their immutable `created` timestamp. For each currency, the opening balance is the sum of every ledger entry before the month; activity is the sum of non-payout net entries during the month; payouts are the absolute value of successful payout ledger debits. Therefore:

`closing balance = opening balance + net activity - payouts`

Charges/payments, refunds, disputes, application (ORBIT) fees, and processor fees are classified only when Stripe's type/reporting category supports that classification. Every remaining net ledger effect becomes an adjustment. This exact residual preserves reconciliation for reserves, fee credits, payout reversals, late events, and new processor transaction types without inventing a financial category. Statements are split by currency and all arithmetic uses integer minor units.

Finalization stores totals, line items, payout metadata, source checksum, rendered PDF bytes, and PDF SHA-256. Opening an old statement never contacts Stripe or recalculates totals. Refunds, disputes, and late webhook activity are recognized in the month their Stripe balance transaction was created.

## Scheduling and retry

Call `POST /api/internal/statements/schedule` from the platform scheduler at least hourly with `Authorization: Bearer $INTERNAL_JOB_SECRET`. At or after `STATEMENT_GENERATION_HOUR` on `STATEMENT_GENERATION_DAY` in `STATEMENT_TIMEZONE`, it enqueues the previous calendar month. BullMQ job IDs and the database unique key `(merchant, period start, currency, version)` make duplicate invocations idempotent.

Email is sent by the existing worker process through STARTTLS by default. Failed deliveries are retried after 15 minutes, 1 hour, and 6 hours. Each attempt and sanitized provider error code is retained. SMTP certificate verification is never disabled. The PDF is linked behind ORBIT authentication and is not attached.

## Manual generation

Owners and admins can run the exact production service:

```bash
curl -X POST http://localhost:3000/api/internal/statements/generate \
  -H "Content-Type: application/json" \
  -H "Cookie: orbit_session=..." \
  -d '{"merchantId":"...","year":2026,"month":8,"dryRun":true}'
```

Start with `dryRun: true`: it reads Stripe, calculates each currency, validates reconciliation, and returns totals without writing, finalizing, or sending email. Set it to `false` to persist and render. Automatic email is queued by the monthly worker; manual generation deliberately does not surprise a merchant with an email.

## Safe SMTP testing

Use a non-production SMTP capture server and a merchant whose agreement contact is a controlled test inbox. Set every `SMTP_*` variable, run a manual non-dry generation, then use the internal Statement operations page to send. Automated tests mock the transport and never use the network. Never put a real password in `.env.example`, logs, frontend variables, or the database.
