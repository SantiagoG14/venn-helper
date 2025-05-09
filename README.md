A typescript library for laying out area proportional venn and euler diagrams.

## Disclaimer 
This is a fork of the Venn.js that is implemented using typescript,
it does not render a venn-diagram but rather provides the functions
to render one. **D3 data visualition is not packaged**. This is to keep
the library light weight

## Original library
Details of how this library works can be found on the [blog
post](http://www.benfrederickson.com/venn-diagrams-with-d3.js/)
I wrote about this. A follow up post [discusses testing strategy and
algorithmic improvements](http://www.benfrederickson.com/better-venn-diagrams/).

### Installing

If you use NPM, `npm install venn-helper`.

##### Simple layout

To lay out a simple diagram, just define the sets and their sizes along with the sizes
of all the set intersections.

The VennDiagram object will calculate a layout that is proportional to the
input sizes, and will return all of the necessary pieces to render a venn
diagram

```typescript
var sets = [
  { sets: ["A"], size: 12 },
  { sets: ["B"], size: 12 },
  { sets: ["A", "B"], size: 2 },
];

vennSolution(safeData, {
  orientation: Math.PI / 2,
  layout: "greedy",
  width: 500,
  height: 500,
  set_id_delimiter: SET_ID_DELIMITER,
  padding: 0,
});
```
