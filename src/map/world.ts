// Map rendering data. Converts the bundled TopoJSON into screen-space SVG paths
// and label anchor points exactly once, at module load. Pure / framework-free so
// it can be reused by any renderer or future game mode.
import { geoEqualEarth, geoPath, geoCentroid, geoArea } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import type { Topology } from 'topojson-specification';
import topo from '../assets/countries-110m.json';
import { countryById } from '../data/countries';

/** Base viewBox the projection is fitted to. The SVG scales responsively. */
export const MAP_WIDTH = 980;
export const MAP_HEIGHT = 500;

export interface MapShape {
  /** Normalised numeric ISO id (no leading zeros). Empty for disputed areas. */
  id: string;
  /** Raw name from the TopoJSON (fallback when no localised name exists). */
  rawName: string;
  /** SVG path data in base viewBox coordinates. */
  d: string;
  /** Label anchor (projected centroid) in base viewBox coordinates. */
  cx: number;
  cy: number;
  /** Area in km² (0 when unknown); drives label decluttering. */
  area: number;
  /** True when this shape can be a quiz target / scored guess. */
  guessable: boolean;
  /** Projected bounding box [x0, y0, x1, y1] in base viewBox coords. */
  bbox: [number, number, number, number];
}

const normId = (id: unknown): string =>
  id == null || id === 'undefined' ? '' : String(Number(id));

const collection = feature(
  topo as unknown as Topology,
  (topo as unknown as Topology).objects.countries,
) as FeatureCollection<Geometry, { name?: string }>;

const projection = geoEqualEarth().fitSize(
  [MAP_WIDTH, MAP_HEIGHT],
  collection,
);
const pathGen = geoPath(projection);

// Anchor the label on the country's LARGEST landmass rather than the centroid of
// the whole feature. Countries with far-flung overseas territories (e.g. France
// incl. French Guiana, Norway incl. Svalbard) otherwise get a centroid out in the
// ocean. Scans every polygon across all of the country's features and returns the
// centroid of the biggest one.
function labelAnchor(
  features: Feature<Geometry, { name?: string }>[],
): [number, number] {
  let best: Position[][] | null = null;
  let bestArea = -1;
  for (const f of features) {
    const g = f.geometry;
    const polys =
      g.type === 'MultiPolygon'
        ? g.coordinates
        : g.type === 'Polygon'
          ? [g.coordinates]
          : [];
    for (const coords of polys) {
      const a = geoArea({ type: 'Polygon', coordinates: coords });
      if (a > bestArea) {
        bestArea = a;
        best = coords;
      }
    }
  }
  return best
    ? geoCentroid({ type: 'Polygon', coordinates: best })
    : geoCentroid(features[0]);
}

// Build one shape from one or more TopoJSON features that share a country id.
// Several features can normalise to the same id (e.g. "Australia" and the tiny
// "Ashmore and Cartier Is.", both ISO 036); merging them yields a single land
// outline, a single label, and a single click target instead of duplicates.
function toShape(
  features: Feature<Geometry, { name?: string }>[],
): MapShape | null {
  const d = features
    .map((f) => pathGen(f))
    .filter((p): p is string => !!p)
    .join('');
  if (!d) return null;
  const id = normId(features[0].id);
  const meta = id ? countryById.get(id) : undefined;
  const centroid = projection(labelAnchor(features)) ?? [0, 0];
  // Union the per-feature projected bounds so the box covers the whole country
  // (merged features included). Used by the renderer to fit-zoom on reveal.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const f of features) {
    const [[bx0, by0], [bx1, by1]] = pathGen.bounds(f);
    if (bx0 < x0) x0 = bx0;
    if (by0 < y0) y0 = by0;
    if (bx1 > x1) x1 = bx1;
    if (by1 > y1) y1 = by1;
  }
  return {
    id,
    rawName: features[0].properties?.name ?? '',
    d,
    cx: centroid[0],
    cy: centroid[1],
    area: meta?.area ?? 0,
    guessable: !!meta,
    bbox: [x0, y0, x1, y1],
  };
}

// Group features by normalised id so each country is one shape. Features with an
// empty id (disputed areas) are never merged together — each stays its own shape.
const groups: Feature<Geometry, { name?: string }>[][] = [];
const byId = new Map<string, Feature<Geometry, { name?: string }>[]>();
for (const f of collection.features) {
  const id = normId(f.id);
  if (!id) {
    groups.push([f]);
    continue;
  }
  const arr = byId.get(id);
  if (arr) arr.push(f);
  else {
    const created = [f];
    byId.set(id, created);
    groups.push(created);
  }
}

export const shapes: MapShape[] = groups
  .map(toShape)
  .filter((s): s is MapShape => s !== null);

/** Ids actually present on the map (intersect with the difficulty pool). */
export const mapIds: Set<string> = new Set(
  shapes.filter((s) => s.guessable).map((s) => s.id),
);
