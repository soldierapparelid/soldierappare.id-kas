# Local Kas PDF export dependencies

These assets are served from this application, not a third-party PDF service. No financial data is uploaded for export. They are reused from the tested SoldierApparel slip exporter with the same versions and licenses.

- jsPDF 4.2.1: https://github.com/parallax/jsPDF/tree/v4.2.1 — MIT, see LICENSE-jsPDF.txt.
- jsPDF-AutoTable 5.0.8: https://github.com/simonbengtsson/jsPDF-AutoTable/tree/v5.0.8 — MIT, see LICENSE-AutoTable.txt.
- Noto Sans Regular/Bold: https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf/NotoSans — SIL Open Font License, see LICENSE-NotoSans.txt. Retrieved 21 September 2026.

Fonts are mechanically optimized using fonttools 4.65.0: `--unicodes=* --no-hinting --layout-features=*`. Every original Unicode mapping is retained. Only hinting/unreachable font data is removed to reduce download and review size. The fonts and their license are otherwise retained; these are modified font builds, not unmodified upstream files.

Original source-font SHA-256:

```
b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5  NotoSans-Regular.ttf
c976e4b1b99edc88775377fcc21692ca4bfa46b6d6ca6522bfda505b28ff9d6a  NotoSans-Bold.ttf
```

SHA-256 (shipped files; JavaScript libraries are unmodified):

```
e6551fcdc32f09d6853b2c5126d18d01d9447e0da618a41a11ebeee0f6c20d54  jspdf-4.2.1.umd.min.js
a65dff2c6a8296b16aff24e69f7683cd7dbaed4a4ec26b507d6840ee27d54649  jspdf-autotable-5.0.8.min.js
c112f6b1a8b92cc4b587313ee8f49da938d1bccc52e1a10fafce89d551b2adbf  NotoSans-Regular.ttf
ddca52c9d4c5021adf68404205816a432198e1c33e46a7660c07fcc8b5e2613b  NotoSans-Bold.ttf
```
