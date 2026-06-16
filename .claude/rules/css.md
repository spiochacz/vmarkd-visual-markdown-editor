---
paths:
  - "media-src/**/*.css"
---
# CSS commenting rules

- Every CSS fix or override must have a comment explaining: what it fixes, why, and how
- Comment inline or directly above the rule — never in a distant block
- Vditor/cascade overrides and specificity hacks especially need the "why" (e.g. which upstream rule they fight)
- Pure layout/styling that reads obviously from the property names needs no comment
