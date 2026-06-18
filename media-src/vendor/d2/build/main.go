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
	Special      special     `json:"special"`
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

type outEdge struct {
	Src      string `json:"src"`
	Dst      string `json:"dst"`
	Label    string `json:"label,omitempty"`
	SrcArrow bool   `json:"srcArrow"`
	DstArrow bool   `json:"dstArrow"`
}

type outGraph struct {
	Shapes   []outShape `json:"shapes"`
	Edges    []outEdge  `json:"edges"`
	Sequence bool       `json:"sequence"` // top-level OR nested sequence_diagram (root isn't in g.Objects)
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
		og.Edges = append(og.Edges, outEdge{
			Src: src, Dst: dst, Label: label,
			SrcArrow: e.SrcArrow, DstArrow: e.DstArrow,
		})
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
