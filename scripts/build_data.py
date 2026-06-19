"""Genera web/data/data.js a partir del dataset abierto mledoze/countries.

Uso (desde cualquier carpeta):
    python scripts/build_data.py

Descarga la lista de países (cacheada en .cache/) y escribe web/data/data.js con
un subconjunto limpio: solo miembros de la ONU con capital y continente. Nombres
de país, capital, moneda e idioma se traducen al español con los archivos de
sources/. Los datos se incrustan como variable global COUNTRIES para que la app
funcione abriendo web/index.html sin servidor.

Fuente: https://github.com/mledoze/countries  (licencia ODbL)
"""

import json
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "sources"
WEB_DATA = ROOT / "web" / "data"
CACHE = ROOT / ".cache"

RAW_URL = "https://raw.githubusercontent.com/mledoze/countries/master/dist/countries.json"
RAW_FILE = CACHE / "countries_raw.json"
CURRENCIES_ES = SOURCES / "currencies_es.json"
LANGUAGES_ES = SOURCES / "languages_es.json"
CAPITALS_ES = SOURCES / "capitals_es.json"
EXTRA = SOURCES / "extra_subdivisions.json"  # naciones constituyentes (no miembros ONU)
OUT_FILE = WEB_DATA / "data.js"

MAIN_REGIONS = {"Africa", "Americas", "Asia", "Europe", "Oceania"}


def load_raw():
    if not RAW_FILE.exists():
        print(f"Descargando dataset desde {RAW_URL} …")
        CACHE.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(RAW_URL, RAW_FILE)
    with open(RAW_FILE, encoding="utf-8") as f:
        return json.load(f)


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def spanish_name(country):
    spa = country.get("translations", {}).get("spa", {})
    return spa.get("common") or country["name"]["common"]


def currency_unit(full_name):
    """Unidad 'neutra' de una moneda: el nombre sin el gentilicio que delata el país.
    'peso chileno' -> 'peso'; 'dólar de Barbados' -> 'dólar'; 'euro' -> 'euro'."""
    for sep in (" del ", " de "):
        if sep in full_name:
            return full_name.split(sep)[0].strip()
    toks = full_name.split()
    return full_name if len(toks) <= 1 else " ".join(toks[:-1])


def mark_askable_currencies(countries):
    """Marca cada moneda con 'q' (texto a mostrar en la pregunta) solo si se puede
    preguntar de forma justa:
      - unidad única entre todos los países (quetzal, naira…) o el euro, y
      - es la moneda PROPIA del país (código que empieza con su ISO, p. ej. ZW→ZWB)
        o la única que usa (caso del euro). Así se evita preguntar por monedas
        ajenas que algunos países listan (p. ej. la canasta de divisas de Zimbabue).
    Se excluyen pseudomonedas como los 'bonos' de Zimbabue (ZWB)."""
    unit_count = Counter()
    for c in countries:
        for m in c["currencies"]:
            unit_count[currency_unit(m["name"])] += 1
    for c in countries:
        cca2 = c["cca2"].upper()
        sole = len(c["currencies"]) == 1
        for m in c["currencies"]:
            u = currency_unit(m["name"])
            distinctive = unit_count[u] == 1 or u == "euro"
            own = m["code"][:2] == cca2
            if distinctive and (own or sole) and m["code"] != "ZWB":
                m["q"] = u


def clean(raw, currency_es, language_es, capital_es):
    out = []
    missing_cur, missing_lang = set(), set()
    for c in raw:
        if not c.get("unMember"):
            continue
        if c.get("region") not in MAIN_REGIONS:
            continue
        capitals = c.get("capital") or []
        if not capitals:
            continue
        currencies = []
        for code, info in (c.get("currencies") or {}).items():
            name = currency_es.get(code)
            if not name:
                missing_cur.add(f"{code} ({info.get('name', '?')})")
                name = info.get("name", code)
            currencies.append({"code": code, "name": name})
        languages = []
        for code, en_name in (c.get("languages") or {}).items():
            name = language_es.get(code)
            if not name:
                missing_lang.add(f"{code} ({en_name})")
                name = en_name
            languages.append({"code": code, "name": name})
        latlng = c.get("latlng") or []
        capital = capital_es.get(capitals[0], capitals[0])
        out.append(
            {
                "name": spanish_name(c),
                "capital": capital,
                "region": c["region"],
                "cca2": c["cca2"].lower(),  # para flagcdn.com y assets
                "currencies": currencies,
                "languages": languages,
                "latlng": [round(latlng[0], 2), round(latlng[1], 2)] if len(latlng) == 2 else None,
            }
        )
    out.extend(load_json(EXTRA))  # Inglaterra, Escocia, Gales, Irlanda del Norte
    out.sort(key=lambda x: x["name"])
    mark_askable_currencies(out)
    if missing_cur:
        print("AVISO: monedas sin traducción en", CURRENCIES_ES, "→", sorted(missing_cur))
    if missing_lang:
        print("AVISO: idiomas sin traducción en", LANGUAGES_ES, "→", sorted(missing_lang))
    return out


def main():
    raw = load_raw()
    data = clean(
        raw, load_json(CURRENCIES_ES), load_json(LANGUAGES_ES), load_json(CAPITALS_ES)
    )
    payload = json.dumps(data, ensure_ascii=False, indent=0).replace("\n", "")
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        f.write("// Generado por build_data.py — no editar a mano.\n")
        f.write("// Fuente: https://github.com/mledoze/countries (ODbL)\n")
        f.write(f"window.COUNTRIES = {payload};\n")
    print(f"OK: {len(data)} países escritos en {OUT_FILE}")


if __name__ == "__main__":
    main()
