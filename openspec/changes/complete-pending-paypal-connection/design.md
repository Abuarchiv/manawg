## Decision
Reuse the existing connect POST with strict `{action:"complete"}`. Before any provider lookup, require verified WG membership, valid expiring signed cookie with matching WG/member/auth-user/code/environment, tracking derived from the currently configured client, and unchanged previous recipient. The nonce is the nonce inside the current signed browser cookie; existing callback URL-to-cookie nonce validation remains unchanged. There is no persisted nonce/revocation model.

GET stays read-only. Query the documented `/v1/customer/partners/{partner_id}/merchant-integrations?tracking_id=...` using only signed tracking. Accept only a single object with exact tracking and a valid merchant ID. Unsupported shapes fail closed. Provider errors retain unknown/error semantics; no speculative 404-as-pending mapping. Re-fetch canonical merchant readiness using existing checks before saving through the existing payment lock, active-member lock and recipient compare-and-set. Concurrent completion/callback may succeed idempotently or return existing stable conflict; never overwrite changed bindings. Cookie clearing occurs only on success. Existing confirm keeps its callback hint contract and gains the same client-tracking/pre-provider binding checks.

UI uses the current member session and apiFetch; no caller-supplied identity or manual Merchant-ID. A missing callback hint can use completion. Plain settings exposes “Verbindung prüfen” for a completed vendor flow with no callback.

## Sources
https://developer.paypal.com/docs/multiparty/seller-onboarding/before-payment/#5-integrate-seller-onboarding
Existing `remove-paypal-profile-setup` design and root private read-only Sandbox evidence establish the single-object response contract.
