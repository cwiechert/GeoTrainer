"""Descarga (una sola vez) los recursos visuales y genera los manifiestos.

Uso (desde cualquier carpeta):
    python scripts/build_assets.py

Baja a web/assets/:
  - silhouettes/<cca2>.svg  → contornos de país (repo abierto djaiss/mapsicon)
  - landmarks/<cca2>.jpg     → foto de un monumento (imagen principal del artículo
                              de Wikipedia listado en sources/landmarks.json)

Y escribe en web/data/:
  - assets.js    → manifiesto (qué países tienen silueta/monumento) como ASSETS
  - worldmap.js  → geometrías de países proyectadas a SVG como WORLDMAP

Es re-ejecutable: omite lo ya descargado. Las descargas crudas se cachean en .cache/.

Fuentes:
  - https://github.com/djaiss/mapsicon  (MIT)
  - https://github.com/nvkelso/natural-earth-vector  (Natural Earth, dominio público)
  - Wikipedia / Wikimedia Commons
"""

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "sources"
WEB = ROOT / "web"
WEB_DATA = WEB / "data"
ASSETS_DIR = WEB / "assets"
SIL_DIR = ASSETS_DIR / "silhouettes"
LM_DIR = ASSETS_DIR / "landmarks"
CACHE = ROOT / ".cache"

UA = "GeoTrainer/1.0 (proyecto educativo)"
DATA_JS = WEB_DATA / "data.js"
LANDMARKS = SOURCES / "landmarks.json"
GEOJSON_FILE = CACHE / "ne_110m_countries.geojson"

SILHOUETTE_URL = "https://raw.githubusercontent.com/djaiss/mapsicon/master/all/{cca2}/vector.svg"
GEOJSON_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "master/geojson/ne_110m_admin_0_countries.geojson"
)
# lienzo del mapa vectorial (equirectangular, proporción 2:1)
MAP_W, MAP_H = 2000, 1000
PAGEIMAGE_API = (
    "https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1"
    "&prop=pageimages&piprop=thumbnail&pithumbsize=640&titles={title}"
)


def get(url, timeout=60, retries=4):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries - 1:
                wait = 5 * (attempt + 1)
                print(f"    429: espero {wait}s y reintento…")
                time.sleep(wait)
                continue
            raise


def download(url, path, timeout=60):
    data = get(url, timeout)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    return len(data)


def load_cca2():
    txt = open(DATA_JS, encoding="utf-8").read()
    data = json.loads(re.search(r"window\.COUNTRIES = (\[.*\]);", txt, re.S).group(1))
    return [c["cca2"] for c in data]


def fetch_silhouettes(cca2_list):
    SIL_DIR.mkdir(parents=True, exist_ok=True)
    have, missing = [], []
    for cca2 in cca2_list:
        dest = SIL_DIR / f"{cca2}.svg"
        if dest.exists() and dest.stat().st_size > 0:
            have.append(cca2)
            continue
        try:
            download(SILHOUETTE_URL.format(cca2=cca2), dest)
            have.append(cca2)
            print(f"  silueta {cca2} ok")
            time.sleep(0.05)
        except Exception as e:
            missing.append(cca2)
            print(f"  silueta {cca2} FALLO ({e})")
    return have, missing


def _polys(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    return []


def build_worldmap():
    """Convierte las geometrías de países (Natural Earth) en rutas SVG proyectadas
    (equirectangular) y escribe web/data/worldmap.js con window.WORLDMAP."""
    if not GEOJSON_FILE.exists():
        print("  descargando geometrías…")
        download(GEOJSON_URL, GEOJSON_FILE, timeout=120)
    gj = json.load(open(GEOJSON_FILE, encoding="utf-8"))

    def proj(lng, lat):
        return round((lng + 180) / 360 * MAP_W), round((90 - lat) / 180 * MAP_H)

    countries = {}
    for feat in gj["features"]:
        p = feat["properties"]
        code = p.get("ISO_A2_EH") or p.get("ISO_A2") or ""
        if not code or code == "-99":
            code = p.get("ISO_A3_EH") or p.get("ISO_A3") or p.get("ADMIN", "")
        code = code.lower()
        if not code:
            continue
        segs = []
        minx = miny = 10 ** 9
        maxx = maxy = -(10 ** 9)
        for poly in _polys(feat["geometry"]):
            for ring in poly:
                pts = []
                for lng, lat in ring:
                    x, y = proj(lng, lat)
                    pts.append(f"{x} {y}")
                    minx, maxx = min(minx, x), max(maxx, x)
                    miny, maxy = min(miny, y), max(maxy, y)
                if pts:
                    segs.append("M" + "L".join(pts) + "Z")
        if not segs:
            continue
        wide = (maxx - minx) > 0.5 * MAP_W or (maxy - miny) > 0.7 * MAP_H
        countries[code] = {"d": "".join(segs), "bb": [minx, miny, maxx, maxy], "x": 1 if wide else 0}

    payload = {"w": MAP_W, "h": MAP_H, "c": countries}
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    with open(WEB_DATA / "worldmap.js", "w", encoding="utf-8") as f:
        f.write("// Generado por build_assets.py — no editar a mano.\n")
        f.write("// Geometrías: Natural Earth (dominio público) vía nvkelso/natural-earth-vector.\n")
        f.write("window.WORLDMAP = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n")
    wide_n = sum(1 for v in countries.values() if v["x"])
    print(f"  worldmap.js ok ({len(countries)} países, {wide_n} excluidos por cruzar el antimeridiano)")


def landmark_thumb(wiki):
    title = urllib.parse.quote(wiki.replace(" ", "_"), safe="")
    data = json.loads(get(PAGEIMAGE_API.format(title=title), timeout=30))
    pages = data.get("query", {}).get("pages", {})
    for page in pages.values():
        src = (page.get("thumbnail") or {}).get("source")
        if src:
            low = src.lower()
            if ".svg" in low or "logo" in low:
                raise ValueError(f"la imagen parece un logo, no una foto: {src}")
            return src
    raise ValueError("sin imagen para el artículo")


def fetch_landmarks():
    LM_DIR.mkdir(parents=True, exist_ok=True)
    landmarks = json.load(open(LANDMARKS, encoding="utf-8"))
    manifest, failed = {}, []
    for lm in landmarks:
        cca2, name, wiki = lm["cca2"], lm["name"], lm["wiki"]
        dest = LM_DIR / f"{cca2}.jpg"
        # ruta relativa al documento (web/index.html), no al sistema de archivos
        web_path = f"assets/landmarks/{cca2}.jpg"
        if dest.exists() and dest.stat().st_size > 0:
            manifest[cca2] = {"name": name, "file": web_path}
            continue
        try:
            download(landmark_thumb(wiki), dest, timeout=60)
            manifest[cca2] = {"name": name, "file": web_path}
            print(f"  monumento {cca2} ({name}) ok")
            time.sleep(0.5)
        except Exception as e:
            failed.append(f"{cca2}/{wiki}")
            print(f"  monumento {cca2} ({wiki}) FALLO ({e})")
    return manifest, failed


def write_manifest(silhouettes, landmarks):
    sil = {c: True for c in silhouettes}
    payload = {"silhouettes": sil, "landmarks": landmarks}
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    with open(WEB_DATA / "assets.js", "w", encoding="utf-8") as f:
        f.write("// Generado por build_assets.py — no editar a mano.\n")
        f.write("window.ASSETS = " + json.dumps(payload, ensure_ascii=False) + ";\n")
    print(f"\nassets.js: {len(sil)} siluetas, {len(landmarks)} monumentos.")


def main():
    cca2_list = load_cca2()
    print("Descargando siluetas…")
    sil_have, sil_missing = fetch_silhouettes(cca2_list)
    print("Generando mapa vectorial…")
    build_worldmap()
    print("Descargando monumentos…")
    lm_manifest, lm_failed = fetch_landmarks()
    write_manifest(sil_have, lm_manifest)
    if sil_missing:
        print("Siluetas no encontradas:", sil_missing)
    if lm_failed:
        print("Monumentos fallidos (revisa sources/landmarks.json):", lm_failed)


if __name__ == "__main__":
    main()
