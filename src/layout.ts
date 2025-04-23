import {
  nelderMead,
  bisect,
  conjugateGradient,
  zeros,
  zerosM,
  norm2,
  scale,
} from "fmin";

import {
  intersectionArea,
  circleOverlap,
  circleCircleIntersection,
  distance,
} from "./circle-intersection";

export type Area = {
  sets: (string | number)[];
  size: number;
  weight?: number;
  label?: string;
};

export type CircleRecord = Record<string | number, Circle>;

export type Circle = {
  x: number;
  y: number;
  rowid?: number;
  size?: number;
  radius: number;
  parent?: Circle;
  setid: string;
};

type OverLap = {
  set: string;
  size: number;
  weight: number;
};

export type Params = {
  /** layout algorithm used during computations of the venn diagram */
  layout?: "greedy" | "MDS" | "best";
  /** max of number iterations when performing a MSDConstrainedLayout */
  restarts?: number;
  maxIterations?: number;
  /** number from 0-1 that to seed the random positions when using the MSDConstrainedLayout */
  seed?: number;
  history?: {
    x: number[];
  }[];
};

type LayoutFunction = (areas: Area[], params: Params) => CircleRecord;

const layoutFunctionMap = new Map<"greedy" | "MDS" | "best", LayoutFunction>([
  ["greedy", greedyLayout],
  ["MDS", constrainedMDSLayout],
  ["best", bestInitialLayout],
]);

/** given a list of set objects, and their corresponding overlaps.
updates the (x, y, radius) attribute on each set such that their positions
roughly correspond to the desired overlaps */
export function venn(areas: Area[], parameters?: Params) {
  parameters = parameters ?? {};
  parameters.maxIterations = parameters.maxIterations || 500;
  parameters.seed = parameters.seed ?? Math.random();

  const initialLayout = layoutFunctionMap.get(parameters.layout ?? "best") as LayoutFunction;
  var loss = lossFunction;

  // add in missing pairwise areas as having 0 size
  areas = addMissingAreas(areas);

  // initial layout is done greedily
  var circles = initialLayout(areas, parameters);

  // transform x/y coordinates to a vector to optimize
  var initial: number[] = [],
    setids: string[] = [];
  for (const setid of Object.keys(circles)) {
    const circle = circles[setid];
    if (!circle) continue;

    initial.push(circle.x);
    initial.push(circle.y);
    setids.push(setid);
  }

  // optimize initial layout from our loss function
  var totalFunctionCalls = 0;
  var solution = nelderMead(
    function (values) {
      totalFunctionCalls += 1;
      var current: CircleRecord = {};
      for (var i = 0; i < setids.length; ++i) {
        var setid = setids[i] as string;
        const circle = circles[setid] as Circle;
        current[setid] = {
          x: values[2 * i]!,
          y: values[2 * i + 1]!,
          radius: circle.radius,
          setid: setid,
          size: circle.size,
          rowid: circle.rowid,
        };
      }
      const l = loss(current, areas);
      return l;
    },
    initial,
    parameters
  );

  // transform solution vector back to x/y points
  var positions = solution.x;
  for (var i = 0; i < setids.length; ++i) {
    const setid = setids[i] as string;
    const circle = circles[setid];
    circle!.x = positions[2 * i]!;
    circle!.y = positions[2 * i + 1]!;
  }

  return circles;
}

var SMALL = 1e-10;

/** Returns the distance necessary for two circles of radius r1 + r2 to
have the overlap area 'overlap' */
export function distanceFromIntersectArea(
  r1: number,
  r2: number,
  overlap: number
) {
  // handle complete overlapped circles
  if (Math.min(r1, r2) * Math.min(r1, r2) * Math.PI <= overlap + SMALL) {
    return Math.abs(r1 - r2);
  }

  return bisect(
    function (distance) {
      return circleOverlap(r1, r2, distance) - overlap;
    },
    0,
    r1 + r2
  );
}

/** Missing pair-wise intersection area data can cause problems:
 treating as an unknown means that sets will be laid out overlapping,
 which isn't what people expect. To reflect that we want disjoint sets
 here, set the overlap to 0 for all missing pairwise set intersections */
function addMissingAreas(areas: Area[]) {
  areas = areas.slice();

  // two circle intersections that aren't defined
  var ids: string[] = [],
    pairs: Record<string, boolean> = {},
    i: number,
    j: number,
    a: string,
    b: string;

  for (const area of areas) {
    if (area.sets.length == 1) {
      ids.push(area.sets[0] as string);
    } else if (area.sets.length == 2) {
      a = area.sets[0] as string;
      b = area.sets[1] as string;
      pairs[`${a},${b}`] = true;
      pairs[`${b},${a}`] = true;
    }
  }

  ids.sort((a, b) => a.toString().localeCompare(b.toString()));

  for (i = 0; i < ids.length; ++i) {
    a = ids[i]!;
    for (j = i + 1; j < ids.length; ++j) {
      b = ids[j]!;
      if (!(`${a},${b}` in pairs)) {
        areas.push({
          sets: [a!, b!],
          size: 0,
        });
      }
    }
  }
  return areas;
}

/// Returns two matrices, one of the euclidean distances between the sets
/// and the other indicating if there are subset or disjoint set relationships
export function getDistanceMatrices(
  areas: Area[],
  sets: Area[],
  setids: Record<string, number>
) {
  // initialize an empty distance matrix between all the points
  var distances = zerosM(sets.length, sets.length),
    constraints = zerosM(sets.length, sets.length);

  // compute required distances between all the sets such that
  // the areas match
  areas
    .filter(function (x) {
      return x.sets.length === 2;
    })
    .map(function (current) {
      var left = setids[current.sets[0]!];
      var right = setids[current.sets[1]!];

      if (left === undefined || right === undefined) return current;

      var r1 = Math.sqrt(sets[left]!.size / Math.PI),
        r2 = Math.sqrt(sets[right]!.size / Math.PI),
        distance = distanceFromIntersectArea(r1, r2, current.size);

      distances[left]![right] = distances[right]![left] = distance;

      // also update constraints to indicate if its a subset or disjoint
      // relationship
      var c = 0;
      if (
        current.size + 1e-10 >=
        Math.min(sets[left]!.size, sets[right]!.size)
      ) {
        c = 1;
      } else if (current.size <= 1e-10) {
        c = -1;
      }
      constraints[left]![right] = constraints[right]![left] = c;
    });

  return { distances: distances, constraints: constraints };
}

/// computes the gradient and loss simulatenously for our constrained MDS optimizer
function constrainedMDSGradient(
  x: number[],
  fxprime: number[],
  distances: number[][],
  constraints: number[][]
) {
  var loss = 0,
    i: number;
  for (i = 0; i < fxprime.length; ++i) {
    fxprime[i] = 0;
  }

  for (i = 0; i < distances.length; ++i) {
    var xi = x[2 * i] as number,
      yi = x[2 * i + 1] as number;
    for (var j = i + 1; j < distances.length; ++j) {
      var xj = x[2 * j] as number,
        yj = x[2 * j + 1] as number,
        dij = distances[i]![j]! as number,
        constraint = constraints[i]![j]! as number;

      var squaredDistance = (xj - xi) * (xj - xi) + (yj - yi) * (yj - yi),
        distance = Math.sqrt(squaredDistance),
        delta = squaredDistance - dij * dij;

      if (
        (constraint > 0 && distance <= dij) ||
        (constraint < 0 && distance >= dij)
      ) {
        continue;
      }

      loss += 2 * delta * delta;

      fxprime[2 * i]! += 4 * delta * (xi - xj);
      fxprime[2 * i + 1]! += 4 * delta * (yi - yj);

      fxprime[2 * j]! += 4 * delta * (xj - xi);
      fxprime[2 * j + 1]! += 4 * delta * (yj - yi);
    }
  }
  return loss;
}

/// takes the best working variant of either constrained MDS or greedy
export function bestInitialLayout(areas: Area[], params: Params) {
  var initial = greedyLayout(areas, params);
  var loss = lossFunction;

  // greedylayout is sufficient for all 2/3 circle cases. try out
  // constrained MDS for higher order problems, take its output
  // if it outperforms. (greedy is aesthetically better on 2/3 circles
  // since it axis aligns)
  if (areas.length >= 8) {
    var constrained = constrainedMDSLayout(areas, params),
      constrainedLoss = loss(constrained, areas),
      greedyLoss = loss(initial, areas);

    if (constrainedLoss + 1e-8 < greedyLoss) {
      initial = constrained;
    }
  }
  return initial;
}

// Simple seeded random number generator (Mulberry32)
function createRandomGenerator(seed: number = 1) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/// use the constrained MDS variant to generate an initial layout
export function constrainedMDSLayout(areas: Area[], params: Params) {
  var restarts = params.restarts || 10;

  // Create a deterministic random generator if seed is provided
  // const random =
  //   params.seed !== undefined ? createRandomGenerator(params.seed) : Math.random

  // bidirectionally map sets to a rowid  (so we can create a matrix)
  var sets: Area[] = [],
    setids: Record<string, number> = {},
    i: number;
  for (i = 0; i < areas.length; ++i) {
    var area = areas[i];
    if (area?.sets.length === 1) {
      if (area.sets[0]) setids[area.sets[0]] = sets.length;
      sets.push(area);
    }
  }

  var matrices = getDistanceMatrices(areas, sets, setids),
    distances = matrices.distances,
    constraints = matrices.constraints;

  // keep distances bounded, things get messed up otherwise.
  // TODO: proper preconditioner?
  var norm = norm2(distances.map(norm2)) / distances.length;
  distances = distances.map(function (row) {
    return row.map(function (value) {
      return value / norm;
    });
  });

  const seed = ((params.seed ?? Math.random()) * 2 ** 32) >>> 0;

  const getRand = createRandomGenerator(seed);

  var best, current;
  for (i = 0; i < restarts; ++i) {
    var initial = zeros(distances.length * 2).map(() => getRand());

    current = conjugateGradient(
      (x, fxprime) =>
        constrainedMDSGradient(x, fxprime, distances, constraints),
      initial,
      params
    );

    if (!best || current.fx < best.fx) {
      best = current;
    }
  }
  var positions = best?.x;

  // translate rows back to (x,y,radius) coordinates
  var circles: CircleRecord = {};
  for (i = 0; i < sets.length; ++i) {
    var set = sets[i];
    const setName = set?.sets[0];

    if (set === undefined || setName === undefined) continue;

    circles[setName] = {
      x: positions![2 * i]! * norm,
      y: positions![2 * i + 1]! * norm,
      radius: Math.sqrt(set.size / Math.PI),
      setid: setName as string,
      size: set.size,
      rowid: Object.keys(circles).length,
    };
  }

  if (params.history) {
    for (const step of params.history) {
      scale(step.x, norm);
    }
  }
  return circles;
}

/** Lays out a Venn diagram greedily, going from most overlapped sets to
least overlapped, attempting to position each new set such that the
overlapping areas to already positioned sets are basically right */
export function greedyLayout(areas: Area[], _params?: Params) {
  var loss = lossFunction;
  // define a circle for each set
  var circles: CircleRecord = {},
    setOverlaps: Record<string, OverLap[]> = {},
    set: string;
  for (var i = 0; i < areas.length; ++i) {
    var area = areas[i] as Area;
    if (area.sets.length == 1) {
      set = area.sets[0] as string;
      circles[set] = {
        x: 1e10,
        y: 1e10,
        rowid: Object.keys(circles).length,
        size: area.size,
        setid: set,
        radius: Math.sqrt(area.size / Math.PI),
      };
      setOverlaps[set] = [];
    }
  }
  areas = areas.filter(function (a) {
    return a.sets.length == 2;
  });

  // map each set to a list of all the other sets that overlap it
  for (i = 0; i < areas.length; ++i) {
    var current = areas[i] as Area;
    var weight = current.weight ? current.weight : 1.0;
    var left = current.sets[0] as string,
      right = current.sets[1] as string;

    if (left === undefined || right === undefined) continue;

    // completely overlapped circles shouldn't be positioned early here
    const leftCircle = circles[left] as Circle;
    const rightCircle = circles[right] as Circle;

    if (!leftCircle.size || !rightCircle.size) continue;

    if (current.size + SMALL >= Math.min(leftCircle.size, rightCircle.size)) {
      weight = 0;
    }

    setOverlaps[left]?.push({ set: right, size: current.size, weight: weight });
    setOverlaps[right]?.push({ set: left, size: current.size, weight: weight });
  }

  // get list of most overlapped sets
  var mostOverlapped: { set: string; size: number }[] = [];
  for (set in setOverlaps) {
    const overlaps = setOverlaps[set];
    if (overlaps) {
      var size = 0;
      for (i = 0; i < overlaps.length; ++i) {
        const overlap = overlaps[i];
        if (!overlap) continue;
        size += overlap.size * overlap.weight;
      }

      mostOverlapped.push({ set: set, size: size });
    }
  }

  mostOverlapped.sort((a, b) => b.size - a.size);

  // keep track of what sets have been laid out
  var positioned: Record<string, boolean> = {};
  function isPositioned(element: OverLap) {
    return element.set in positioned;
  }

  // adds a point to the output
  function positionSet(point: { x: number; y: number }, index: string) {
    const circle = circles[index];
    if (circle) {
      circle.x = point.x;
      circle.y = point.y;
    }
    positioned[index] = true;
  }

  // add most overlapped set at (0,0)
  positionSet({ x: 0, y: 0 }, mostOverlapped[0]?.set ?? "");

  // get distances between all points. TODO, necessary?
  // answer: probably not
  // var distances = venn.getDistanceMatrices(circles, areas).distances;
  for (i = 1; i < mostOverlapped.length; ++i) {
    var setIndex = mostOverlapped[i]?.set;
    var overlap = setIndex ? setOverlaps[setIndex]?.filter(isPositioned) : null;
    const set = setIndex ? circles[setIndex] : null;

    overlap?.sort((a, b) => b.size - a.size);

    if (overlap?.length === 0) {
      // this shouldn't happen anymore with addMissingAreas
      throw "ERROR: missing pairwise overlap information";
    }

    if (!overlap) {
      // this shouldn't happen anymore with addMissingAreas
      throw "ERROR: missing pairwise overlap information";
    }

    var points: { x: number; y: number }[] = [];
    for (var j = 0; j < overlap.length; ++j) {
      // get appropriate distance from most overlapped already added set
      const item = overlap[j];

      if (!item) continue;

      var p1 = circles[overlap[j]!.set];

      if (!p1) continue;

      const d1 = distanceFromIntersectArea(set!.radius, p1.radius, item.size);

      // sample positions at 90 degrees for maximum aesthetics
      points.push({ x: p1.x + d1, y: p1.y });
      points.push({ x: p1.x - d1, y: p1.y });
      points.push({ y: p1.y + d1, x: p1.x });
      points.push({ y: p1.y - d1, x: p1.x });

      // if we have at least 2 overlaps, then figure out where the
      // set should be positioned analytically and try those too
      for (var k = j + 1; k < overlap.length; ++k) {
        var p2 = circles[overlap[k]!.set],
          d2 = distanceFromIntersectArea(
            set!.radius,
            p2!.radius,
            overlap[k]!.size
          );

        var extraPoints = circleCircleIntersection(
          { x: p1.x, y: p1.y, radius: d1 },
          { x: p2!.x, y: p2!.y, radius: d2 }
        );

        for (var l = 0; l < extraPoints.length; ++l) {
          points.push(extraPoints[l]!);
        }
      }
    }

    // we have some candidate positions for the set, examine loss
    // at each position to figure out where to put it at
    var bestLoss = 1e50,
      bestPoint = points[0];
    for (j = 0; j < points.length; ++j) {
      circles[setIndex!]!.x = points[j]!.x;
      circles[setIndex!]!.y = points[j]!.y;
      var localLoss = loss(circles, areas);
      if (localLoss < bestLoss) {
        bestLoss = localLoss;
        bestPoint = points[j];
      }
    }

    positionSet(bestPoint!, setIndex!);
  }

  return circles;
}

/** Given a bunch of sets, and the desired overlaps between these sets - computes
the distance from the actual overlaps to the desired overlaps. Note that
this method ignores overlaps of more than 2 circles */
export function lossFunction(sets: CircleRecord, overlaps: Area[]) {
  var output = 0;

  function getCircles(indices: (string | number)[]) {
    return indices.map(function (i) {
      return sets[i];
    });
  }

  for (var i = 0; i < overlaps.length; ++i) {
    var area = overlaps[i],
      overlap: number;
    if (!area || area.sets.length === 1) continue;

    if (area.sets.length === 2) {
      var left = sets[area.sets[0]!],
        right = sets[area.sets[1]!];

      if (left === undefined || right === undefined) continue;

      overlap = circleOverlap(
        left!.radius,
        right!.radius,
        distance(left!, right!)
      );
    } else {
      overlap = intersectionArea(getCircles(area.sets) as Circle[]).overlap;
    }

    var weight = area.weight ? area.weight : 1.0;
    output += weight * (overlap - area.size) * (overlap - area.size);
  }

  return output;
}

// orientates a bunch of circles to point in orientation
function orientateCircles(
  circles: Circle[],
  orientation?: number,
  orientationOrder?: (a: Circle, b: Circle) => number
) {
  if (orientationOrder === null) {
    circles.sort(function (a, b) {
      return b.radius - a.radius;
    });
  } else {
    circles.sort(orientationOrder);
  }

  var i: number;
  // shift circles so largest circle is at (0, 0)
  if (circles.length > 0) {
    var largestX = circles[0]!.x,
      largestY = circles[0]!.y;

    for (i = 0; i < circles.length; ++i) {
      circles[i]!.x -= largestX;
      circles[i]!.y -= largestY;
    }
  }

  if (circles.length == 2) {
    // if the second circle is a subset of the first, arrange so that
    // it is off to one side. hack for https://github.com/benfred/venn.js/issues/120
    const c1 = circles[0];
    const c2 = circles[1];
    if (c1 && c2) {
      var dist = distance(c1, c2);
      if (dist < Math.abs(c2.radius - c1.radius)) {
        c2.x = c1.x + c1.radius - c2.radius - 1e-10;
        c2.y = c2.y;
      }
    }
  }

  // rotate circles so that second largest is at an angle of 'orientation'
  // from largest
  if (circles.length > 1) {
    var rotation =
        Math.atan2(circles[1]!.x, circles[1]!.y) - (orientation ?? 0),
      c = Math.cos(rotation),
      s = Math.sin(rotation),
      x: number,
      y: number;

    for (i = 0; i < circles.length; ++i) {
      const circle = circles[i];
      if (!circle) continue;
      x = circle.x;
      y = circle.y;
      circle.x = c * x - s * y;
      circle.y = s * x + c * y;
    }
  }

  // mirror solution if third solution is above plane specified by
  // first two circles
  if (circles.length > 2) {
    var angle = Math.atan2(circles[2]!.x, circles[2]!.y) - (orientation ?? 0);

    while (angle < 0) {
      angle += 2 * Math.PI;
    }

    while (angle > 2 * Math.PI) {
      angle -= 2 * Math.PI;
    }

    if (angle > Math.PI) {
      var slope = circles[1]!.y / (1e-10 + circles[1]!.x);
      for (i = 0; i < circles.length; ++i) {
        const circle = circles[i];
        if (!circle) continue;

        var d = (circle.x + slope * circle.y) / (1 + slope * slope);
        circle.x = 2 * d - circle.x;
        circle.y = 2 * d * slope - circle.y;
      }
    }
  }
}

export function disjointCluster(circles: Circle[]) {
  // union-find clustering to get disjoint sets
  circles.map(function (circle) {
    circle.parent = circle;
  });

  // path compression step in union find
  function find(circle: Circle | undefined): Circle | undefined {
    if (!circle) return undefined;

    if (circle.parent !== circle) {
      circle.parent = find(circle.parent);
    }
    return circle.parent;
  }

  function union(x: Circle, y: Circle) {
    var xRoot = find(x),
      yRoot = find(y);

    if (!xRoot) return;

    xRoot.parent = yRoot;
  }

  // get the union of all overlapping sets
  for (var i = 0; i < circles.length; ++i) {
    for (var j = i + 1; j < circles.length; ++j) {
      const c1 = circles[i];
      const c2 = circles[j];
      if (!c1 || !c2) continue;

      var maxDistance = c1.radius + c2.radius;
      if (distance(c1, c2) + 1e-10 < maxDistance) {
        union(c2, c1);
      }
    }
  }

  // find all the disjoint clusters and group them together
  var disjointClusters: Record<string, Circle[]> = {},
    setid: string | number;
  for (i = 0; i < circles.length; ++i) {
    const circle = circles[i];

    if (!circle) continue;

    const parentCircle = find(circles[i]);
    const setid = parentCircle?.parent?.setid;

    if (!setid) continue;

    if (!(setid in disjointClusters)) {
      disjointClusters[setid] = [];
    }

    if (disjointClusters[setid]) disjointClusters[setid].push(circle);
  }

  // cleanup bookkeeping
  circles.map(function (circle) {
    delete circle.parent;
  });

  // return in more usable form
  var ret = [];
  for (setid in disjointClusters) {
    const cluster = disjointClusters[setid];
    if (cluster) {
      ret.push(cluster);
    }
  }
  return ret;
}

function getBoundingBox(circles: Circle[]) {
  var minMax = function (d: "x" | "y") {
    var hi = Math.max.apply(
        null,
        circles.map(function (c) {
          return c[d] + c.radius;
        })
      ),
      lo = Math.min.apply(
        null,
        circles.map(function (c) {
          return c[d] - c.radius;
        })
      );
    return { max: hi, min: lo };
  };

  return { xRange: minMax("x"), yRange: minMax("y") };
}

type Bounds = {
  xRange: {
    max: number;
    min: number;
  };
  yRange: {
    max: number;
    min: number;
  };
};

export function normalizeSolution(
  solution: Record<string | number, Circle>,
  orientation?: number,
  orientationOrder?: (a: Circle, b: Circle) => number
) {
  if (orientation === null) {
    orientation = Math.PI / 2;
  }

  // work with a list instead of a dictionary, and take a copy so we
  // don't mutate input
  var circles: Circle[] = [],
    i,
    setid: string;
  for (setid in solution) {
    var previous = solution[setid];
    if (!previous) continue;
    circles.push({ ...previous, setid: setid });
  }

  // get all the disjoint clusters
  var clusters: (Circle[] & { size?: number; bounds?: Bounds })[] =
    disjointCluster(circles);

  // orientate all disjoint sets, get sizes
  for (i = 0; i < clusters.length; ++i) {
    const cluster = clusters[i] as Circle[] & {
      size: number;
      bounds: Bounds;
    };

    if (!cluster) continue;

    orientateCircles(cluster, orientation, orientationOrder);

    var bounds = getBoundingBox(cluster);
    cluster.size =
      (bounds.xRange.max - bounds.xRange.min) *
      (bounds.yRange.max - bounds.yRange.min);
    cluster.bounds = bounds;
  }

  clusters.sort(function (a, b) {
    if (!a.size || !b.size) return 0;
    return b.size - a.size;
  });

  // orientate the largest at 0,0, and get the bounds
  //circles = clusters[0];
  let largestCluster = clusters[0]!;
  var returnBounds = largestCluster.bounds!;

  var spacing = (returnBounds.xRange.max - returnBounds.xRange.min) / 50;

  function addCluster(
    cluster: (Circle[] & { size?: number; bounds?: Bounds }) | undefined,
    right: boolean,
    bottom: boolean
  ) {
    if (!cluster) return;

    if (!cluster.size || !cluster.bounds) return;

    var bounds = cluster.bounds,
      xOffset,
      yOffset,
      centreing;

    if (right) {
      xOffset = returnBounds.xRange.max - bounds.xRange.min + spacing;
    } else {
      xOffset = returnBounds.xRange.max - bounds.xRange.max;
      centreing =
        (bounds.xRange.max - bounds.xRange.min) / 2 -
        (returnBounds.xRange.max - returnBounds.xRange.min) / 2;
      if (centreing < 0) xOffset += centreing;
    }

    if (bottom) {
      yOffset = returnBounds.yRange.max - bounds.yRange.min + spacing;
    } else {
      yOffset = returnBounds.yRange.max - bounds.yRange.max;
      centreing =
        (bounds.yRange.max - bounds.yRange.min) / 2 -
        (returnBounds.yRange.max - returnBounds.yRange.min) / 2;
      if (centreing < 0) yOffset += centreing;
    }

    for (var j = 0; j < cluster.length; ++j) {
      const circle = cluster[j];
      if (!circle) continue;
      circle.x += xOffset;
      circle.y += yOffset;
      circles.push(circle);
    }
  }

  var index = 1;
  while (index < clusters.length) {
    addCluster(clusters[index], true, false);
    addCluster(clusters[index + 1], false, true);
    addCluster(clusters[index + 2], true, true);
    index += 3;

    // have one cluster (in top left). lay out next three relative
    // to it in a grid
    returnBounds = getBoundingBox(circles);
  }

  // convert back to solution form
  var ret: CircleRecord = {};
  for (const circle of circles) {
    ret[circle.setid!] = circle;
  }
  return ret;
}

/** Scales a solution from venn.venn or venn.greedyLayout such that it fits in
a rectangle of width/height - with padding around the borders. also
centers the diagram in the available space at the same time */
export function scaleSolution(
  solution: CircleRecord,
  width: number,
  height: number,
  padding: number
) {
  var circles: Circle[] = [],
    setids: string[] = [];
  for (var setid in solution) {
    const circle = solution[setid];
    if (circle) {
      setids.push(setid);
      circles.push(circle);
    }
  }

  width -= 2 * padding;
  height -= 2 * padding;

  var bounds = getBoundingBox(circles),
    xRange = bounds.xRange,
    yRange = bounds.yRange;

  if (xRange.max == xRange.min || yRange.max == yRange.min) {
    return solution;
  }

  var xScaling = width / (xRange.max - xRange.min),
    yScaling = height / (yRange.max - yRange.min),
    scaling = Math.min(yScaling, xScaling),
    // while we're at it, center the diagram too
    xOffset = (width - (xRange.max - xRange.min) * scaling) / 2,
    yOffset = (height - (yRange.max - yRange.min) * scaling) / 2;

  var scaled: CircleRecord = {};
  for (var i = 0; i < circles.length; ++i) {
    var circle = circles[i];
    const id = setids[i];

    if (!circle || !id) continue;
    scaled[id] = {
      ...circle,
      radius: scaling * circle.radius,
      x: padding + xOffset + (circle.x - xRange.min) * scaling,
      y: padding + yOffset + (circle.y - yRange.min) * scaling,
    };
  }

  return scaled;
}
