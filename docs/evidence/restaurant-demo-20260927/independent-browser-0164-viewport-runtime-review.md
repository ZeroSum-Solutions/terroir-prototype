# Bounded actual viewport review

Verdict: PASS for long-label exact-bottle drawer geometry and keyboard focus at 320, 390, 768 and 1200px widths, all at 900px height. Not a whole-page visual-polish or production-browser PASS.

Independently read the actual result and execution receipts and viewed all four screenshots. The corrected run exited 0; the initial failed run (exit 1, no observations) remains separately preserved. No browser or database calls were made by this reviewer.

- Source SHA256: `8290a153da6b9cdf1d71d466acbf8b5903d12fe185b486e0aafbc692592b5e04`.
- `journey/evidence-viewport-r2/viewport-result.json`: `99e2eed70466a0ec91517ef940ec56232c8a88365c30dab0b4ac8f98a2c6dda8`.
- `journey/viewport-execution-receipts.json`: `c8dd90ace34c32355191f517e19647aff2f828ab0a8868a13f57bd3db4b79cdd`.

All four widths report no horizontal overflow. Both service buttons are enabled, fully within the measured viewport, 52px high and at least 136px wide. Keyboard navigation reaches the primary action after 17 tabs with focus-visible asserted. The exact selected staff bottle and passed 600ml/version 1 staff receipt are bound by the script. The long producer/wine heading wraps visibly without horizontal clipping in all screenshots.

Visual limitations retained: the LOCAL environment badge crowds the site label at 320px and overlaps Scan at 768px; the Next development indicator partially covers the mobile Open another bottle label. These are outside the scoped drawer geometry checks and preclude claiming a complete header/visual polish pass. The screenshots occur after keyboard scrolling, so some stock content is above the visible drawer body; they are not separate screenshots proving bottle volume. No inventory actions were clicked by the viewport script.

Final protected-data conservation and owned-runtime cleanup remain separate closeout requirements.
