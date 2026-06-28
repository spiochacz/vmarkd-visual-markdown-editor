# Mermaid error fixture

A deliberately broken mermaid block (invalid `--<` arrow) to exercise the clean
parse-error box (suppressErrorRendering + `.vmarkd-mermaid-error`).

```mermaid
flowchart TD
  A --< B
```
