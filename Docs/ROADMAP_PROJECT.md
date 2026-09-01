# ROADMAP — Dates Analytics Log
### Dashboard de Comparación de Cohortes | GAS + BigQuery + Vue.js 3

---

## 0. Resumen del Proyecto

**Objetivo:** Construir una SPA Enterprise alojada en Google Apps Script que consuma datos de BigQuery (granularidad `partner_id` + `fecha`) y permita comparar hasta 4 grupos (cohortes) de partners con filtros dinámicos, gráficos sincronizados y un ranking tabular de alto volumen.

**Riesgo crítico identificado (según KEY_NOTES):** la query maestra entrega datos "planos" con dos trampas matemáticas que el frontend DEBE resolver correctamente:
1. Ratios/CVRs nunca se promedian: se recalculan `SUM(numerador)/SUM(denominador)` en memoria.
2. `city_total_sessions_raw` viene duplicado por cada partner de la ciudad → hay que desduplicar por `ciudad+fecha` antes de sumar sesiones.

Todo el roadmap está diseñado para blindar esta lógica desde el día 1, porque un error aquí invalida el dashboard completo aunque la UI se vea perfecta.

**Stack:** GAS (backend puro, sin cómputo) + Vue.js 3 (CDN, sin build) + Tailwind CSS + Apache ECharts + BigQuery.

---

## 1. Principios de Arquitectura (no negociables)

- El backend `.gs` **nunca** calcula métricas de negocio. Solo ejecuta la Query Maestra y devuelve JSON plano.
- Todo el motor matemático (dedupe, ratios, share, penetración) vive en un único módulo (`Store.html`), aislado de la UI. Ninguna vista debe hacer sus propios cálculos.
- Una sola carga de datos por click en "Aplicar". Cualquier interacción posterior (cambiar eje, tipo de gráfico, agrupar por semana) es 100% client-side sobre el dataset ya cargado.
- Cada grupo de comparación es un objeto independiente en el estado (filtros propios + rango temporal propio), nunca un slice global.

---

## 2. Estructura de Archivos (GAS)

```
Config.gs           → BQ_CONFIG (proyecto, dataset, tabla), constantes
Main.gs              → doGet(e) + include(filename)
Controller.gs        → fetchDashboardData(filters) — valida input antes de tocar BQ
Service_BigQuery.gs  → Query Maestra + ejecución + formateo a array de objetos

Index.html           → shell, CDNs, includes
Styles.html          → Tailwind config + estilos custom
Store.html           → estado reactivo + motor matemático (dedupe, CVRs, share, penetración)
UI_Filters.html       → filtros globales, gestor de grupos, selector temporal, botón Aplicar
UI_Charts.html        → render/sync de gráficos (ECharts), fusión, breakdowns
UI_Table.html         → ranking virtualizado, sticky header, sort
```

---

## 3. Fases de Desarrollo

### Fase 0 — Setup y Fundaciones (Día 1)
- Crear proyecto GAS + repo GitHub (clasp para sincronizar local↔GAS).
- `Config.gs` con `BQ_CONFIG` apuntando a `peya-bi-tools-pro` y parámetros de fecha configurables (no hardcodear `2026-01-01`/`2026-01-31` como en la query de ejemplo).
- Documentación base: `README.md`, `ROADMAP_PROJECT.md` (este archivo), `BITACORA_REFACTOR.md` vacía, y primer snapshot con repomix para tu flujo de contexto en NotebookLM/Gemini.
- `Index.html` cargando CDNs: Vue 3, Tailwind, ECharts. Verificar que GAS sirve el shell sin errores (hola-mundo reactivo).

**Entregable:** WebApp vacía desplegada, reactiva, con estructura de archivos completa.

### Fase 1 — Backend: Query Maestra y Contrato de Datos (Días 2–3)
- Portear la Query Maestra a `Service_BigQuery.gs`, parametrizando: rango de fechas, ciudades, zonas, franquicias.
- `Controller.gs`: `fetchDashboardData(filters)` valida tipos/rangos antes de ejecutar BQ (evitar queries sin filtro de fecha que escaneen todo el dataset).
- Definir y congelar el **contrato JSON** de salida (columnas del Dataset del punto 2 del DATA_SHEET) — esto es lo que consume `Store.html`, así que cualquier cambio de nombre de columna rompe el frontend.
- Probar `google.script.run` de punta a punta devolviendo un dataset real (una ciudad, un mes) al frontend y loguearlo en consola.

**Entregable:** Un click de prueba trae datos reales de BigQuery al navegador en formato JSON limpio.

### Fase 2 — Store.html: El Motor Matemático (Días 4–6) ⚠️ Fase crítica
Esta fase se construye y se testea **antes** de tocar cualquier gráfico o tabla, con datos mock si hace falta.

- `dedupeCitySessions(rows)` → agrupa por `ciudad+fecha`, toma un único valor de `city_total_sessions_raw` (y sus derivados) por combinación.
- `calcRatio(rows, numeradorKey, denominadorKey)` → función genérica `SUM(num)/SUM(den)`, usada para Fail Rate, Open Time %, y cualquier CVR. Nunca se promedian columnas de porcentaje directamente.
- `calcShareOverGroup(partnerOrders, groupTotalOrders)` → share dinámico por grupo renderizado.
- `calcPenetracion(partnerOrders, dedupedCitySessions)` → usa el resultado de `dedupeCitySessions`, nunca la columna cruda.
- Estado reactivo por grupo: `groups[]` con `{ id, filtrosLocales, rangoTemporal, rawData, aggregatedData }`.
- **Suite de validación manual:** armar 2–3 casos de prueba a mano (ej. 3 partners de una ciudad en 2 fechas) y verificar que Fail Rate, sesiones deduplicadas y share calzan con el cálculo hecho en una hoja de cálculo aparte. Documentar estos casos en `BITACORA_REFACTOR.md` como referencia de regresión.

**Entregable:** Módulo de estado que, dado el JSON crudo, produce métricas agregadas correctas y verificadas — sin ninguna UI todavía.

### Fase 3 — UI_Filters.html: Panel de Configuración (Días 7–8)
- Filtros globales (multiselect `city_name_log`, `zone_name_log`, `franchise_name`, toggles Mall/Logistic).
- Gestor de grupos (2 a 4), cada uno heredando filtros globales con overrides locales.
- Selector temporal por grupo con sus 4 modos: fechas específicas, día de semana + semanas, semanas, meses.
- Botón "Aplicar" → dispara `google.script.run.fetchDashboardData()` por grupo, con Skeleton Loaders mientras resuelve.

**Entregable:** Se pueden armar hasta 4 grupos con filtros y rangos distintos, y traer sus datasets crudos al Store.

### Fase 4 — UI_Charts.html: Visualización (Días 9–11)
- Un gráfico ECharts por grupo, alineados horizontalmente, alimentados por `aggregatedData` del Store (nunca por `rawData` directo).
- Controles por gráfico: selector de métricas, eje Y (izq/der), tipo (área/línea/barra), agrupación temporal (día vs. totales del periodo), toggle data labels.
- Sincronización de tooltips entre gráficos vía el sistema de eventos de ECharts (`connect` / `axisPointer` compartido).
- Botón "Fusionar" → superpone series de todos los grupos en un gráfico único.
- Breakdowns por dimensión categórica (`is_mall`, `is_logistic_marketplace`) en valores absolutos o Share %.

**Entregable:** Comparación visual completa entre grupos, con interacción fluida sin llamadas al servidor.

### Fase 5 — UI_Table.html: Ranking de Partners (Días 12–13)
- Agregación a nivel `vendor_code` para el periodo evaluado (reutilizando las funciones del Store, no recalculando).
- Columnas: id, name, total_orders, rejected_orders, fail rate %, open time compliance %, is_mall, is_logistic_marketplace, Penetración, Share over group.
- Virtual scrolling + sticky header + sort ascendente/descendente por columna.
- Tabs o tabla anidada por grupo.

**Entregable:** Ranking navegable con miles de filas sin colapsar el DOM.

### Fase 6 — QA Matemático y de Performance (Días 14–15)
- Re-ejecutar los casos de validación de la Fase 2 ya integrados end-to-end (UI → Store → gráficos/tabla) para confirmar que no se introdujeron errores de agregación al conectar las vistas.
- Probar con 4 grupos simultáneos y datasets grandes (varios meses, varias ciudades) para medir tiempos de respuesta de BigQuery y fluidez del render.
- Revisar edge cases: grupo sin datos, partner sin franquicia (`Sin Franquicia`), ciudad sin zona logística (`Sin Zona Logística`), sesiones en cero (evitar división por cero — confirmar que se usa `SAFE_DIVIDE` también en el frontend).

**Entregable:** Checklist de QA firmado, sin discrepancias entre cálculo manual y cálculo del dashboard.

### Fase 7 — Deploy y Documentación Final (Día 16)
- Deploy como WebApp de GAS con permisos definidos (acceso restringido al equipo).
- Cerrar `README.md` (cómo correr, cómo desplegar, contrato de datos) y `BITACORA_REFACTOR.md`.
- Generar snapshot final con repomix para tu archivo de contexto en NotebookLM/Drive.

**Entregable:** Dashboard en producción + documentación lista para retomar el proyecto sin perder contexto.

---

## 4. Riesgos y Mitigaciones

| Riesgo | Mitigación |
|---|---|
| Promediar campos `_pct` por error en algún gráfico o tabla nuevo | Toda métrica de ratio pasa obligatoriamente por `calcRatio()` del Store; prohibido leer columnas `_pct` crudas en la UI |
| Doble conteo de `city_total_sessions_raw` | `dedupeCitySessions()` es la única puerta de entrada a sesiones de ciudad; se llama una vez por grupo al cargar datos |
| Queries BigQuery lentas con muchos filtros/fechas amplias | Validación de filtros en `Controller.gs` antes de ejecutar; considerar límite de rango de fechas por grupo |
| Fecha hardcodeada en la Query Maestra (`2026-01-01`/`2026-01-31`) | Parametrizar en `Service_BigQuery.gs` desde el día 1, no dejarlo para el final |
| GAS se siente lento por cómputo en servidor | Regla de arquitectura de la Fase 0: cero cálculo de negocio en `.gs`, todo en `Store.html` |

---

## 5. Estimación Total

**~16 días de desarrollo enfocado**, con la Fase 2 (motor matemático) como bloque crítico que no debe comprimirse: ahí se juega la confiabilidad de todo el dashboard.

---

## 6. Siguiente Paso Inmediato

Empezar por la **Fase 0 + Fase 1**: dejar la Query Maestra parametrizada y el contrato JSON congelado. Todo lo demás (Store, filtros, gráficos, tabla) se construye sobre ese contrato, así que cualquier cambio de nombre de columna después de esta etapa implica retrabajo en cascada.
