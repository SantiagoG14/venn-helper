import type { Area, Circle, CircleRecord, Params } from "./layout"

import { intersectionArea, distance, getCenter } from "./circle-intersection"
import { venn, normalizeSolution, scaleSolution } from "./layout"
import { nelderMead } from "fmin"

type Options = {
  orientation: number
  width: number
  height: number
  padding: number
  normalize: boolean
}

export function chartVega(data: Area[], options: Options, vennParams: Params) {
  const filteredData = data.filter(
    (datum) => datum.size !== 0 && datum.sets.length > 0
  )

  let circles: CircleRecord = {}
  let textCenters: TextCenterRecord = {}

  if (filteredData.length > 0) {
    let solution = venn(filteredData, vennParams)

    if (options.normalize) {
      solution = normalizeSolution(solution, options.orientation)
    }

    circles = scaleSolution(
      solution,
      options.width,
      options.height,
      options.padding
    )
    textCenters = computeTextCentres(circles, filteredData)
  }

  const intersections = filteredData
    .map((datum) => {
      if (datum.sets.length <= 1) return null

      return {
        sets: datum,
        path: intersectionAreaPath(datum.sets.map((set) => circles[set]!)),
        text: datum.label || datum.sets.join("∩"),
      }
    })
    .filter(Boolean)

  const circlesData = Object.entries(circles).map(([key, circle]) => ({
    set: key,
    x: circle.x,
    y: circle.y,
    size: Math.pow(circle.radius * 2, 2),
    text: key,
    textX: textCenters[key]!.x,
    textY: textCenters[key]!.y,
  }))

  const schema = {
    $schema: "https://vega.github.io/schema/vega/v5.json",
    width: options.width,
    height: options.height,
    padding: options.padding,

    data: [
      {
        name: "circles",
        values: circlesData,
      },
      {
        name: "intersections",
        values: intersections,
      },
    ],

    scales: [
      {
        name: "color",
        type: "ordinal",
        domain: { data: "circles", field: "set" },
        range: "category",
      },
    ],

    marks: [
      {
        type: "symbol",
        from: { data: "circles" },
        encode: {
          enter: {
            x: { field: "x" },
            y: { field: "y" },
            size: { field: "size" },
            shape: { value: "circle" },
            fillOpacity: { value: 0.3 },
            fill: { scale: "color", field: "set" },
            tooltip: [{ field: "text", type: "quantitative" }],
          },
          hover: {
            fillOpacity: { value: 0.5 },
          },
          update: {
            fillOpacity: { value: 0.3 },
          },
        },
      },
      {
        type: "path",
        from: { data: "intersections" },
        encode: {
          enter: {
            path: { field: "path" },
            fill: { value: "grey" },
            fillOpacity: { value: 0 },
            tooltip: [{ field: "text", type: "quantitative" }],
          },

          hover: {
            stroke: { value: "black" },
            strokeWidth: { value: 1 },
            fill: { value: "grey" },
          },

          update: {
            strokeWidth: { value: 0 },
          },
        },
      },
      {
        type: "text",
        from: { data: "circles" },
        encode: {
          enter: {
            x: { field: "textX" },
            y: { field: "textY" },
            text: { field: "text" },
            fontSize: { value: 14 },
            fill: { scale: "color", field: "set" },
            fontWeight: { value: "normal" },
          },
        },
      },
    ],
  }

  return { circles: circlesData, intersections, schema }
}

export function intersectionAreaPath(circles: Circle[]) {
  const { stats } = intersectionArea(circles)
  var arcs = stats.arcs

  if (arcs.length === 0) {
    return "M 0 0"
  }

  if (arcs.length === 1) {
    var circle = arcs[0]!.circle
    return circlePath(circle.x, circle.y, circle.radius)
  }

  // draw path around arcs
  var ret = ["\nM", arcs[0]!.p2.x, arcs[0]!.p2.y]
  for (const arc of arcs) {
    const r = arc.circle.radius
    const wide = arc.width > r
    ret.push("\nA", r, r, 0, wide ? 1 : 0, 1, arc.p1.x, arc.p1.y)
  }

  return ret.join(" ")
}

export function circlePath(x: number, y: number, r: number) {
  var ret: (string | number)[] = []
  ret.push("\nM", x.toString(), y.toString())
  ret.push("\nm", -r, 0)
  ret.push("\na", r, r, 0, 1, 0, r * 2, 0)
  ret.push("\na", r, r, 0, 1, 0, -r * 2, 0)
  return ret.join(" ")
}

export type TextCenterRecord = ReturnType<typeof computeTextCentres>
export function computeTextCentres(circles: CircleRecord, areas: Area[]) {
  var ret: Record<
      string | number,
      { x: number; y: number; disjoint?: boolean }
    > = {},
    overlapped = getOverlappingCircles(circles)
  for (var i = 0; i < areas.length; ++i) {
    var area = areas[i]!.sets,
      areaids: Record<string, boolean> = {},
      exclude: Record<string, boolean> = {}
    for (var j = 0; j < area.length; ++j) {
      areaids[area[j]!]! = true
      var overlaps = overlapped[area[j]!]
      // keep track of any circles that overlap this area,
      // and don't consider for purposes of computing the text
      // centre
      if (!overlaps) continue

      for (var k = 0; k < overlaps.length; ++k) {
        exclude[overlaps[k]!] = true
      }
    }

    var interior: Circle[] = [],
      exterior: Circle[] = []
    for (var setid in circles) {
      if (setid in areaids) {
        interior.push(circles[setid]!)
      } else if (!(setid in exclude)) {
        exterior.push(circles[setid]!)
      }
    }

    var centre = computeTextCentre(interior, exterior)
    ret[area.toString()] = centre

    if (centre.disjoint && areas[i]!.size > 0) {
      console.log("WARNING: area " + area + " not represented on screen")
    }
  }
  return ret
}

function getOverlappingCircles(circles: CircleRecord) {
  var ret: Record<string, string[]> = {},
    circleids = Object.keys(circles)

  circleids.forEach((id) => (ret[id] = []))

  for (var i = 0; i < circleids.length; i++) {
    var a = circles[circleids[i]!]

    for (var j = i + 1; j < circleids.length; ++j) {
      var b = circles[circleids[j]!],
        d = distance(a!, b!)

      if (d + b!.radius <= a!.radius + 1e-10) {
        ret[circleids[j]!]!.push(circleids[i]!)
      } else if (d + a!.radius <= b!.radius + 1e-10) {
        ret[circleids[i]!]!.push(circleids[j]!)
      }
    }
  }
  return ret
}

// compute the center of some circles by maximizing the margin of
// the center point relative to the circles (interior) after subtracting
// nearby circles (exterior)
export function computeTextCentre(interior: Circle[], exterior: Circle[]) {
  // get an initial estimate by sampling around the interior circles
  // and taking the point with the biggest margin
  var points: { x: number; y: number }[] = [],
    i: number
  for (i = 0; i < interior.length; ++i) {
    var c = interior[i]

    if (!c) continue
    points.push({ x: c.x, y: c.y })
    points.push({ x: c.x + c.radius / 2, y: c.y })
    points.push({ x: c.x - c.radius / 2, y: c.y })
    points.push({ x: c.x, y: c.y + c.radius / 2 })
    points.push({ x: c.x, y: c.y - c.radius / 2 })
  }
  var initial = points[0],
    margin = circleMargin(points[0]!, interior, exterior)
  for (i = 1; i < points.length; ++i) {
    var m = circleMargin(points[i]!, interior, exterior)
    if (m >= margin) {
      initial = points[i]
      margin = m
    }
  }

  // maximize the margin numerically
  var solution = nelderMead(
    function (p) {
      return -1 * circleMargin({ x: p[0]!, y: p[1]! }, interior, exterior)
    },
    [initial!.x, initial!.y],
    { maxIterations: 500, minErrorDelta: 1e-10 }
  ).x
  var ret: { x: number; y: number; disjoint?: boolean } = {
    x: solution[0]!,
    y: solution[1]!,
  }

  // check solution, fallback as needed (happens if fully overlapped
  // etc)
  var valid = true
  for (i = 0; i < interior.length; ++i) {
    if (distance(ret, interior[i]!) > interior[i]!.radius) {
      valid = false
      break
    }
  }

  for (i = 0; i < exterior.length; ++i) {
    if (distance(ret, exterior[i]!) < exterior[i]!.radius) {
      valid = false
      break
    }
  }

  if (!valid) {
    if (interior.length == 1) {
      ret = { x: interior[0]!.x, y: interior[0]!.y }
    } else {
      const { stats: areaStats } = intersectionArea(interior)

      if (areaStats.arcs.length === 0) {
        ret = { x: 0, y: -1000, disjoint: true }
      } else if (areaStats.arcs.length === 1) {
        ret = {
          x: areaStats.arcs[0]!.circle.x,
          y: areaStats.arcs[0]!.circle.y,
        }
      } else if (exterior.length) {
        // try again without other circles
        ret = computeTextCentre(interior, [])
      } else {
        // take average of all the points in the intersection
        // polygon. this should basically never happen
        // and has some issues:
        // https://github.com/benfred/venn.js/issues/48#issuecomment-146069777
        ret = getCenter(
          areaStats.arcs.map(function (a) {
            return a.p1
          })
        )
      }
    }
  }

  return ret
}

function circleMargin(
  current: { x: number; y: number },
  interior: Circle[],
  exterior: Circle[]
) {
  var margin = interior[0]!.radius - distance(interior[0]!, current),
    i,
    m

  for (i = 1; i < interior.length; ++i) {
    m = interior[i]!.radius - distance(interior[i]!, current)
    if (m <= margin) {
      margin = m
    }
  }

  for (i = 0; i < exterior.length; ++i) {
    m = distance(exterior[i]!, current) - exterior[i]!.radius
    if (m <= margin) {
      margin = m
    }
  }
  return margin
}
