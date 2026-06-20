"""Genera web/data/landmarks.js con 1-5 monumentos por país.

- Semilla: sources/landmarks.json (imágenes ya descargadas en web/assets/landmarks/).
- Ampliación: Wikidata — los lugares más famosos de cada país (por número de
  Wikipedias), con imagen servida online desde Wikimedia Commons.
- Re-ejecutable: conserva lo ya generado y solo completa los países que falten,
  así que si el servicio de Wikidata corta, basta con volver a correrlo.

Uso:
    python scripts/build_landmarks.py
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
WEB_DATA = ROOT / "web" / "data"
DATA_JS = WEB_DATA / "data.js"
OUT = WEB_DATA / "landmarks.js"
SEED = SOURCES / "landmarks.json"

TARGET = 5  # máximo de monumentos por país
UA = "GeoTrainer/1.0 (proyecto educativo)"
WDQS = "https://query.wikidata.org/sparql"

# tipos "monumento/lugar" (instancia o subclase): atracción turística, monumento,
# sitio arqueológico, castillo, palacio, torre, puente, museo, catedral, mezquita,
# iglesia, templo, montaña, cascada, lago, plaza.
TYPES = " ".join(
    f"wd:{q}" for q in [
        "Q570116", "Q4989906", "Q839954", "Q23413", "Q16560", "Q12518", "Q12280",
        "Q33506", "Q2977", "Q32815", "Q16970", "Q44539", "Q8502", "Q34038",
        "Q23397", "Q174782",
    ]
)


def load_json(p):
    return json.load(open(p, encoding="utf-8"))


def countries():
    txt = open(DATA_JS, encoding="utf-8").read()
    return json.loads(re.search(r"window\.COUNTRIES = (\[.*\]);", txt, re.S).group(1))


def http_get(url, timeout=90):
    for _ in range(3):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": UA, "Accept": "application/sparql-results+json"}
            )
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print("    429 (límite de Wikidata): pausa 20s…")
                time.sleep(20)
                continue
            raise  # 504/500/… → el llamador decide el fallback
        except Exception:
            time.sleep(5)
    raise RuntimeError("sin respuesta de Wikidata")


def query_wd(iso, subclass=True):
    type_clause = (
        f"?place wdt:P31/wdt:P279* ?t. VALUES ?t {{ {TYPES} }}"
        if subclass
        else f"VALUES ?t {{ {TYPES} }} ?place wdt:P31 ?t."
    )
    q = f"""
    SELECT ?place ?placeLabel ?sitelinks ?img WHERE {{
      ?c wdt:P297 "{iso}" .
      ?place wdt:P17 ?c ; wdt:P18 ?img ; wikibase:sitelinks ?sitelinks .
      {type_clause}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "es,en". }}
    }} ORDER BY DESC(?sitelinks) LIMIT 50
    """
    url = WDQS + "?" + urllib.parse.urlencode({"query": q, "format": "json"})
    data = json.loads(http_get(url))
    seen, out = set(), []
    for b in data["results"]["bindings"]:
        qid = b["place"]["value"]
        if qid in seen:
            continue
        seen.add(qid)
        img = b["img"]["value"]
        if ".svg" in img.lower():
            continue
        name = b["placeLabel"]["value"].strip()
        if not name or re.fullmatch(r"Q\d+", name):  # sin etiqueta en es/en
            continue
        name = name[0].upper() + name[1:]
        src = img.replace("http://", "https://") + "?width=640"
        out.append({"name": name, "src": src})
    return out


def write(result):
    payload = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// Generado por build_landmarks.py — no editar a mano.\n")
        f.write("// Imágenes: Wikimedia Commons (vía Wikidata). Semilla: sources/landmarks.json.\n")
        f.write("window.LANDMARKS = " + payload + ";\n")


def main():
    C = countries()
    # resultado: continuar desde lo ya generado si existe
    result = {}
    if OUT.exists():
        m = re.search(r"window\.LANDMARKS = (\{.*\});", open(OUT, encoding="utf-8").read(), re.S)
        if m:
            result = json.loads(m.group(1))

    # semilla (monumento curado con imagen local) como primer elemento
    for s in load_json(SEED):
        cca2 = s["cca2"]
        result.setdefault(cca2, [])
        local = f"assets/landmarks/{cca2}.jpg"
        if not any(e["src"] == local for e in result[cca2]):
            result[cca2].insert(0, {"name": s["name"], "src": local})
    write(result)
    print(f"Semilla escrita: {sum(len(v) for v in result.values())} monumentos.")

    todo = [c for c in C if "-" not in c["cca2"] and len(result.get(c["cca2"], [])) < TARGET]
    print(f"Países por ampliar: {len(todo)}")
    fails = 0
    for c in todo:
        cca2 = c["cca2"]
        result.setdefault(cca2, [])  # países sin semilla (p. ej. Andorra)
        try:
            extra = query_wd(cca2.upper(), subclass=True)
        except Exception:
            try:
                extra = query_wd(cca2.upper(), subclass=False)  # consulta más liviana
            except Exception as e:
                print(f"  {c['name']}: FALLO ({e})")
                fails += 1
                if fails >= 6:
                    print("Demasiados fallos seguidos: el servicio de Wikidata parece caído. "
                          "Aborto; vuelve a correr el script cuando se normalice.")
                    return
                time.sleep(3)
                continue
        fails = 0
        have = {e["name"].lower() for e in result[cca2]}
        added = 0
        for e in extra:
            if len(result[cca2]) >= TARGET:
                break
            if e["name"].lower() in have:
                continue
            result[cca2].append(e)
            have.add(e["name"].lower())
            added += 1
        print(f"  {c['name']}: +{added} (total {len(result[cca2])})")
        write(result)  # guardado incremental → re-ejecutable
        time.sleep(3)
    print("Listo.")


if __name__ == "__main__":
    main()
