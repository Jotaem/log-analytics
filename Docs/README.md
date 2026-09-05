# Dates Analytics Log

Dashboard SPA de comparación de cohortes de partners (fill rate, sesiones, CVRs), alojado en Google Apps Script y alimentado por BigQuery.

Repo: https://github.com/Jotaem/log-analytics

## Stack

- **Backend:** Google Apps Script (`.gs`) — solo sirve el HTML y expone `google.script.run` hacia BigQuery. Cero cómputo de negocio en el servidor.
- **Frontend:** Vue.js 3 (CDN) + Tailwind CSS + Apache ECharts, sin build/Node — todo vía `<?!= include() ?>`.
- **Datos:** BigQuery, tabla base con granularidad `partner_id` + `fecha`.

## Estructura de archivos

```
Config.gs           → BQ_CONFIG (proyecto, dataset, tabla) y constantes. Rango de fechas y filtros son variables, NO hardcodeados.
Main.gs              → doGet(e) + helper include(filename)
Controller.gs        → fetchDashboardData(filters) — valida filtros antes de tocar BigQuery
Service_BigQuery.gs  → Query Maestra parametrizada + formateo a array de objetos JSON

Index.html           → shell principal, carga de CDNs, includes de las piezas de frontend
Styles.html          → configuración de Tailwind + estilos custom
Store.html           → estado reactivo + motor matemático (dedupe de sesiones, ratios, share, penetración)
UI_Filters.html       → filtros globales, gestor de grupos (2-4), selector temporal, botón Aplicar
UI_Charts.html        → render y sincronización de gráficos por grupo, fusión, breakdowns
UI_Table.html         → ranking de partners virtualizado, sticky header, sort
```

## Regla de oro

Toda métrica de tipo ratio/porcentaje (Fail Rate, Open Time %, CVRs) se calcula **siempre** como `SUM(numerador) / SUM(denominador)` dentro de `Store.html`. Nunca se promedian columnas `_pct` directamente, y nunca se suma `city_total_sessions_raw` sin desduplicar antes por `ciudad + fecha`. Ver `ROADMAP_PROJECT.md` Fase 2 para el detalle de estas funciones y `KEY_NOTES.md` para el razonamiento original.

## Documentación del proyecto

- `ROADMAP_PROJECT.md` — plan de fases y entregables.
- `BITACORA_REFACTOR.md` — registro de cada sesión de trabajo (qué se hizo, decisiones, pendientes).
- `DATA_SHEET.md` / `KEY_NOTES.md` — especificación funcional y riesgos matemáticos originales del proyecto.

## Desarrollo local (clasp)

Este proyecto se edita localmente y se sincroniza con Apps Script vía [`clasp`](https://github.com/google/clasp). Ver sección de comandos de setup en la respuesta que acompaña este README para la inicialización del repo.

## Estado actual

Fase 0 — Setup y Fundaciones. Ver `ROADMAP_PROJECT.md` y la última entrada de `BITACORA_REFACTOR.md` para el detalle de avance.
