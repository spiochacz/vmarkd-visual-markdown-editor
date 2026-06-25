//go:build js && wasm

package main

import (
	"encoding/json"
	"strings"
	"syscall/js"

	"oss.terrastruct.com/d2/d2compiler"
	"oss.terrastruct.com/d2/d2graph"
)

type outShape struct {
	ID           string      `json:"id"`
	IDVal        string      `json:"idVal"`
	Label        string      `json:"label"`
	Shape        string      `json:"shape"`
	Container    string      `json:"container,omitempty"`
	Fill         string      `json:"fill,omitempty"`
	Stroke       string      `json:"stroke,omitempty"`
	StrokeWidth  string      `json:"strokeWidth,omitempty"`
	StrokeDash   string      `json:"strokeDash,omitempty"`
	Opacity      string      `json:"opacity,omitempty"`
	FontColor    string      `json:"fontColor,omitempty"`
	BorderRadius string      `json:"borderRadius,omitempty"`
	Bold         bool        `json:"bold,omitempty"`
	Italic       bool        `json:"italic,omitempty"`
	Columns      []outColumn `json:"columns,omitempty"` // sql_table
	Fields       []outMember `json:"fields,omitempty"`  // class fields
	Methods      []outMember `json:"methods,omitempty"` // class methods
	// Per-container layout direction (up|down|left|right), task 127. Empty = inherit.
	Direction string  `json:"direction,omitempty"`
	Special   special `json:"special"`
}

type outColumn struct {
	Name       string `json:"name"`
	Type       string `json:"type,omitempty"`
	Constraint string `json:"constraint,omitempty"`
}

type outMember struct {
	Name       string `json:"name"`
	Type       string `json:"type,omitempty"` // field type / method return
	Visibility string `json:"visibility,omitempty"`
}

type special struct {
	IsSequence  bool   `json:"isSequence"`
	IsGrid      bool   `json:"isGrid"`
	GridRows    string `json:"gridRows,omitempty"`
	GridColumns string `json:"gridColumns,omitempty"`
	NearKey     string `json:"nearKey,omitempty"`
}

// outArrowhead = the shape + optional label of one end of an edge (task 128). Shape is the
// d2-resolved arrowhead string (triangle, diamond, filled-diamond, cf-many, …); label is the
// crow's-foot cardinality / role text (e.g. "1", "*", a role name).
type outArrowhead struct {
	Shape string `json:"shape"`
	Label string `json:"label,omitempty"`
}

type outEdge struct {
	Src      string `json:"src"`
	Dst      string `json:"dst"`
	Label    string `json:"label,omitempty"`
	SrcArrow bool   `json:"srcArrow"`
	DstArrow bool   `json:"dstArrow"`
	// Connection style (task 124 #1) from e.Style. Empty/false = the source set none → the renderer
	// keeps the theme default (themeColor / width 2). Shapes already carry these; edges didn't.
	Stroke      string `json:"stroke,omitempty"`
	StrokeWidth string `json:"strokeWidth,omitempty"`
	StrokeDash  string `json:"strokeDash,omitempty"`
	Opacity     string `json:"opacity,omitempty"`
	Animated    bool   `json:"animated,omitempty"`
	// Per-end arrowhead shape/label, only when the source set one (task 128). When nil the
	// renderer falls back to the SrcArrow/DstArrow boolean (default triangle / none).
	SrcArrowhead *outArrowhead `json:"srcArrowhead,omitempty"`
	DstArrowhead *outArrowhead `json:"dstArrowhead,omitempty"`
	// Column-level (sql_table) endpoints, task 133. When set, the edge attaches to that column's
	// row of the table node (d2 computes these indices at compile time; nil = a whole-node edge).
	SrcColumnIndex *int `json:"srcColumnIndex,omitempty"`
	DstColumnIndex *int `json:"dstColumnIndex,omitempty"`
}

type outGraph struct {
	Shapes   []outShape `json:"shapes"`
	Edges    []outEdge  `json:"edges"`
	Sequence bool       `json:"sequence"` // top-level OR nested sequence_diagram (root isn't in g.Objects)
	// Root layout direction (up|down|left|right), task 127. Empty = default (down). The root
	// object isn't in g.Objects, so this graph-level field carries the top-level `direction:`.
	Direction string `json:"direction,omitempty"`
}

func styleVal(s *d2graph.Scalar) string {
	if s == nil {
		return ""
	}
	return s.Value
}

func compileToJSON(src string) (string, error) {
	g, _, err := d2compiler.Compile("index", strings.NewReader(src), &d2compiler.CompileOptions{})
	if err != nil {
		return "", err
	}
	og := outGraph{}
	for _, o := range g.Objects {
		container := ""
		if o.Parent != nil && o.Parent.ID != "" {
			container = o.Parent.AbsID()
		}
		sp := special{
			IsSequence:  o.IsSequenceDiagram(),
			IsGrid:      o.IsGridDiagram(),
			GridRows:    styleVal(o.GridRows),
			GridColumns: styleVal(o.GridColumns),
		}
		if o.NearKey != nil {
			sp.NearKey = strings.Join(d2graph.Key(o.NearKey), ".")
		}
		sh := outShape{
			ID:           o.AbsID(),
			IDVal:        o.IDVal,
			Label:        o.Label.Value,
			Shape:        o.Shape.Value,
			Container:    container,
			Fill:         styleVal(o.Style.Fill),
			Stroke:       styleVal(o.Style.Stroke),
			StrokeWidth:  styleVal(o.Style.StrokeWidth),
			StrokeDash:   styleVal(o.Style.StrokeDash),
			Opacity:      styleVal(o.Style.Opacity),
			FontColor:    styleVal(o.Style.FontColor),
			BorderRadius: styleVal(o.Style.BorderRadius),
			Bold:         styleVal(o.Style.Bold) == "true",
			Italic:       styleVal(o.Style.Italic) == "true",
			Direction:    o.Direction.Value, // per-container direction (task 127)
			Special:      sp,
		}
		// sql_table columns + class fields/methods (for the bespoke JS renderers)
		if o.SQLTable != nil {
			for _, c := range o.SQLTable.Columns {
				sh.Columns = append(sh.Columns, outColumn{
					Name:       c.Name.Label,
					Type:       c.Type.Label,
					Constraint: strings.Join(c.Constraint, ","),
				})
			}
		}
		if o.Class != nil {
			for _, f := range o.Class.Fields {
				sh.Fields = append(sh.Fields, outMember{Name: f.Name, Type: f.Type, Visibility: f.Visibility})
			}
			for _, m := range o.Class.Methods {
				sh.Methods = append(sh.Methods, outMember{Name: m.Name, Type: m.Return, Visibility: m.Visibility})
			}
		}
		og.Shapes = append(og.Shapes, sh)
	}
	for _, e := range g.Edges {
		var src, dst, label string
		if e.Src != nil {
			src = e.Src.AbsID()
		}
		if e.Dst != nil {
			dst = e.Dst.AbsID()
		}
		label = e.Label.Value
		oe := outEdge{
			Src: src, Dst: dst, Label: label,
			SrcArrow: e.SrcArrow, DstArrow: e.DstArrow,
			// Connection style (task 124 #1); empty when unset → renderer keeps the theme default.
			Stroke:      styleVal(e.Style.Stroke),
			StrokeWidth: styleVal(e.Style.StrokeWidth),
			StrokeDash:  styleVal(e.Style.StrokeDash),
			Opacity:     styleVal(e.Style.Opacity),
			Animated:    styleVal(e.Style.Animated) == "true",
			// d2 sets these to a column row when the edge endpoint is <table>.<col> (task 133).
			SrcColumnIndex: e.SrcTableColumnIndex,
			DstColumnIndex: e.DstTableColumnIndex,
		}
		// ToArrowhead() resolves the shape string incl. filled-* variants (task 128).
		if e.SrcArrowhead != nil {
			oe.SrcArrowhead = &outArrowhead{Shape: string(e.SrcArrowhead.ToArrowhead()), Label: e.SrcArrowhead.Label.Value}
		}
		if e.DstArrowhead != nil {
			oe.DstArrowhead = &outArrowhead{Shape: string(e.DstArrowhead.ToArrowhead()), Label: e.DstArrowhead.Label.Value}
		}
		og.Edges = append(og.Edges, oe)
	}
	// Root-level `direction:` lives on g.Root (not in g.Objects), task 127.
	if g.Root != nil {
		og.Direction = g.Root.Direction.Value
	}
	// A top-level `shape: sequence_diagram` lives on the ROOT object, which is NOT in
	// g.Objects — so per-shape isSequence misses it. Walk each object's ancestor chain
	// (incl. the root) to catch both the top-level and the named-container forms.
	for _, o := range g.Objects {
		for p := o; p != nil; p = p.Parent {
			if p.IsSequenceDiagram() {
				og.Sequence = true
				break
			}
		}
		if og.Sequence {
			break
		}
	}
	b, err := json.Marshal(og)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func d2compile(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return map[string]interface{}{"error": "missing d2 source"}
	}
	out, err := compileToJSON(args[0].String())
	if err != nil {
		return map[string]interface{}{"error": err.Error()}
	}
	return map[string]interface{}{"graph": out}
}

func main() {
	js.Global().Set("d2compile", js.FuncOf(d2compile))
	select {}
}
