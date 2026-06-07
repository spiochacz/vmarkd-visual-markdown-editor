# Task 81 — Verify the Marketplace publisher via domain

**Status:** TODO (optional trust polish; do when a domain is available)

> **Source:** post-1.0.0 publish follow-up (publisher `spiochacz` is live but unverified).
> **Value / Risk:** 🟢 trust/credibility (verified badge) / trivial — no code.

## Problem

`spiochacz.vmarkd` is published, but the publisher is **unverified**. The VS
Marketplace shows a blue "verified" checkmark next to a publisher's name only
after domain verification, which raises install trust and reduces the
"unknown publisher" friction for new users.

This is a Marketplace account action — **no repo/code change**.

## Steps

1. Have a domain you control (e.g. a personal/project domain). Marketplace
   verification is per-domain, tied to the publisher.
2. Marketplace publisher management →
   https://marketplace.visualstudio.com/manage/publishers/spiochacz →
   publisher settings → **Verified domain** → enter the domain.
3. Add the **DNS TXT record** the portal gives you to that domain's DNS, then
   click **Verify**. Propagation can take a while.
4. Once verified, the publisher displays the verified badge; the extension page
   (https://marketplace.visualstudio.com/items?itemName=spiochacz.vmarkd) reflects it.

## Notes

- Open VSX has its own (separate) namespace-claim flow if/when we publish there
  (`OPEN_VSX_TOKEN` not yet set) — out of scope for this task.
- Nothing in the repo gates on this; purely a Marketplace-side credibility step.

## Verify

- Publisher page shows the verified checkmark next to `spiochacz`.

## Ref

- https://learn.microsoft.com/en-us/azure/devops/extend/publish/overview#verify-a-publisher
