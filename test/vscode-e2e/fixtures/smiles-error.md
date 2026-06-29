# SMILES validation error (malformed molecule)

A caffeine SMILES with a trailing lowercase `f` is invalid — smiles-drawer's parser rejects it.
Instead of rendering nothing (a silent empty `<svg>`), the editor must show the themed error box.

```smiles
CN1C=NC2=C1C(=O)N(C(=O)N2C)Cf
```

after paragraph
