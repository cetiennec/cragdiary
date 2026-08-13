/**
 * A small map of a gym's surroundings, built straight from OpenStreetMap tiles
 * rather than from a Leaflet instance: a card only needs a picture of where the
 * place is, and a real map per card would mean one live map object each.
 *
 * Why tiles and not a photo from the gym's own site: barely half of them expose
 * an `og:image`, so half the cards would sit empty — and the site's CSP allows
 * `img-src` from the OSM tile servers already, where anything else would have
 * to be re-hosted or the policy widened.
 */

const TILE = 256;
// Close enough to show the street the gym is on, far enough to place it in its
// town. Also the zoom the map itself opens around a pin, so the two agree.
const ZOOM = 15;
const HEIGHT = 96;
// The widest a thumbnail is ever painted (see `.seeker-gym-thumb`). The tile
// grid below is sized from it, so the picture can never run out of tiles.
const MAX_WIDTH = 512;
const COLUMNS = Math.ceil((MAX_WIDTH + TILE) / TILE);
const ROWS = Math.ceil((HEIGHT + TILE) / TILE);

/** Web-Mercator pixel coordinates at `ZOOM`, the usual slippy-map maths. */
function worldPixel(lat: number, lon: number) {
  const scale = TILE * 2 ** ZOOM;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

export default function GymThumb({
  lat,
  lon,
  alt,
}: {
  lat: number;
  lon: number;
  /** What the picture is of — a card's image is decoration only if unnamed. */
  alt: string;
}) {
  const centre = worldPixel(lat, lon);
  // The top-left corner of the visible box, in world pixels, then the tile it
  // falls in and how far into that tile it sits.
  const left = centre.x - MAX_WIDTH / 2;
  const top = centre.y - HEIGHT / 2;
  const firstX = Math.floor(left / TILE);
  const firstY = Math.floor(top / TILE);
  const offsetX = firstX * TILE - left;
  const offsetY = firstY * TILE - top;

  const tiles = [];
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      const x = firstX + column;
      const y = firstY + row;
      // Wrapping matters at the date line; a tile row above the pole doesn't
      // exist at all, and is simply not drawn.
      const wrapped = ((x % 2 ** ZOOM) + 2 ** ZOOM) % 2 ** ZOOM;
      if (y < 0 || y >= 2 ** ZOOM) continue;
      tiles.push(
        <img
          key={`${x},${y}`}
          src={`https://tile.openstreetmap.org/${ZOOM}/${wrapped}/${y}.png`}
          alt=""
          width={TILE}
          height={TILE}
          // Off-screen cards must not fetch: a page of results would otherwise
          // ask the tile servers for a few hundred tiles nobody looks at.
          loading="lazy"
          decoding="async"
          style={{ left: offsetX + column * TILE, top: offsetY + row * TILE }}
        />
      );
    }
  }

  return (
    <div className="seeker-gym-thumb" role="img" aria-label={alt}>
      {tiles}
      <span className="seeker-gym-thumb-dot" aria-hidden />
    </div>
  );
}
