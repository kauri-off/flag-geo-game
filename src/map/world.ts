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
// ocean.
function labelAnchor(f: Feature<Geometry, { name?: string }>): [number, number] {
  const g = f.geometry;
  if (g.type === 'MultiPolygon') {
    let best: Position[][] = g.coordinates[0];
    let bestArea = -1;
    for (const coords of g.coordinates) {
      const a = geoArea({ type: 'Polygon', coordinates: coords });
      if (a > bestArea) {
        bestArea = a;
        best = coords;
      }
    }
    return geoCentroid({ type: 'Polygon', coordinates: best });
  }
  return geoCentroid(f);
}

function toShape(f: Feature<Geometry, { name?: string }>): MapShape | null {
  const d = pathGen(f);
  if (!d) return null;
  const id = normId(f.id);
  const meta = id ? countryById.get(id) : undefined;
  const centroid = projection(labelAnchor(f)) ?? [0, 0];
  return {
    id,
    rawName: f.properties?.name ?? '',
    d,
    cx: centroid[0],
    cy: centroid[1],
    area: meta?.area ?? 0,
    guessable: !!meta,
  };
}

export const shapes: MapShape[] = collection.features
  .map(toShape)
  .filter((s): s is MapShape => s !== null);

/** Ids actually present on the map (intersect with the difficulty pool). */
export const mapIds: Set<string> = new Set(
  shapes.filter((s) => s.guessable).map((s) => s.id),
);
