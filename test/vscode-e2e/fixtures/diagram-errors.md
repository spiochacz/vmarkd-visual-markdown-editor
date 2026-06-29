# Diagram validation/render errors (task 178)

Every block below is deliberately BROKEN so each engine reports a parse/render error. The unified
`.vmarkd-diagram-error` box must replace the raw "X render error:" dump / blank / source.

## graphviz — invalid DOT

```graphviz
digraph G { a -> }
```

## echarts — invalid spec JSON

```echarts
{ "series": [ }
```

## flowchart — not flowchart syntax

```flowchart
!!! this is definitely not @@@ flowchart syntax ###
```

## vega — invalid JSON

```vega
{ "mark": "bar", }}}
```

## wavedrom — invalid JSON

```wavedrom
{ signal: [ }
```

## nomnoml — unbalanced bracket

```nomnoml
[unbalanced
```

## d2 — invalid syntax (unclosed block)

```d2
a -> b: {
```
