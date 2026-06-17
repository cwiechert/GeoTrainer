# 🌍 GeoTrainer

App web para entrenar geografía con preguntas de opción múltiple (5 alternativas).

## Formatos de pregunta

Preguntas de texto:

- **Capital → País**: "¿A qué país pertenece la capital X?"
- **País → Capital**: "¿Cuál es la capital de X?"
- **País → Continente**: "¿En qué continente está X?"
- **Moneda → País**: "¿Qué país usa la moneda X?"
- **País → Idioma**: "¿Qué idioma se habla en X?"

Preguntas visuales:

- **Bandera → País**: muestra una bandera y pregunta el país.
- **País → Bandera**: muestra 5 banderas y se elige la del país.
- **Silueta → País**: muestra el contorno de un país.
- **Ubicación → País**: resalta un país (con zoom a su región) en el mapa mundial.
- **Monumento → País**: muestra la foto de un lugar emblemático.

Cada pregunta muestra un **badge con su tipo**. Puedes elegir qué formatos
aparecen y **filtrar por uno o varios continentes** (selección múltiple).
La app lleva aciertos, precisión y racha.

## Estructura del proyecto

```
geo_trainer/
├── web/                  # la app web (abrir web/index.html)
│   ├── index.html
│   ├── css/styles.css
│   ├── js/app.js
│   ├── data/             # generado: data.js, assets.js, worldmap.js
│   └── assets/           # imágenes: silhouettes/, landmarks/
├── scripts/              # generadores de datos/recursos
│   ├── build_data.py
│   └── build_assets.py
├── sources/              # entradas curadas (traducciones, lista de monumentos)
│   ├── capitals_es.json
│   ├── currencies_es.json
│   ├── languages_es.json
│   └── landmarks.json
└── .cache/               # descargas crudas (ignorado por git, se regenera)
```

`web/` es estático y autónomo: es lo único que se necesita para jugar (o desplegar).
`scripts/` y `sources/` solo se usan para regenerar el contenido de `web/`.

## Cómo ejecutar

No necesita instalación ni build. **Abre `web/index.html` directamente** en tu
navegador (doble clic).

> Las banderas (formatos bandera→país y país→bandera) se cargan desde
> flagcdn.com, así que necesitan internet. Las siluetas, el mapa y los
> monumentos están empaquetados localmente (`web/assets/`) y funcionan offline.
> Si esos recursos no existen, los formatos visuales simplemente no aparecen —
> corre `python scripts/build_assets.py` para generarlos.

## Datos

Los datos (países, capitales, continentes, monedas, idiomas) están empaquetados en
`web/data/data.js`, generado a partir del dataset abierto
[mledoze/countries](https://github.com/mledoze/countries) (licencia ODbL).
Se filtran a los 194 estados miembros de la ONU para tener un set reconocible.
Los nombres de países, capitales, monedas e idiomas están en español. El dataset
los trae en inglés, así que se traducen con los archivos de `sources/`
(`capitals_es.json`, `currencies_es.json`, `languages_es.json`). En la pregunta de
idioma se evitan los idiomas muy obscuros (criollos, lenguas de señas, hiperlocales)
como respuesta o distractor para que sea justa.

Para regenerar los datos (descarga la versión más reciente del dataset):

```bash
python scripts/build_data.py
```

> El dataset crudo se cachea en `.cache/`; puedes borrar esa carpeta y se vuelve
> a descargar.

Las banderas se obtienen como imágenes de [flagcdn.com](https://flagcdn.com)
usando el código ISO de cada país.

> Nota: la API REST Countries (v3.1) fue deprecada y la v5 requiere API key con
> límite de peticiones, por eso usamos el dataset abierto que la alimenta.

### Recursos visuales (siluetas, mapa, monumentos)

Se descargan **una sola vez** a `web/assets/` y se generan los manifiestos
`web/data/assets.js` y `web/data/worldmap.js`:

```bash
python scripts/build_assets.py
```

- **Siluetas**: contornos de país de [mapsicon](https://github.com/djaiss/mapsicon) (MIT).
- **Mapa**: geometrías de [Natural Earth](https://github.com/nvkelso/natural-earth-vector)
  (dominio público) proyectadas a SVG en el build → `worldmap.js`. En cada pregunta
  se resalta el país y se ajusta el zoom a su región. Los países que cruzan el
  antimeridiano (Rusia, Fiyi) no se usan como pregunta de mapa.
- **Monumentos**: imagen principal del artículo de Wikipedia listado en
  `sources/landmarks.json` (vía la API de Wikipedia). Edita ese archivo para añadir
  o cambiar monumentos; el script reporta los que no encuentre imagen.

El script es re-ejecutable: omite lo ya descargado.

## Ideas para próximas versiones

- Modo "el intruso" y comparaciones (población/área)
- Persistir estadísticas y errores frecuentes para repasar (repetición espaciada)
- Más monumentos en `sources/landmarks.json` (actualmente ~50 países)
