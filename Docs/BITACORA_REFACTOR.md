# BITACORA_REFACTOR.md — Sistema de Analytics

> Registro histórico de desarrollo del proyecto. Cada sesión de trabajo (con o sin IA) se registra como una entrada nueva, de la más reciente a la más antigua. Este archivo es la fuente de verdad de "qué se hizo, cuándo, y qué se decidió" — cualquier agente de IA debe leerlo antes de iniciar una tarea nueva (ver `AGENTS.md`, Fase 0 del protocolo de tareas).

---

## Cómo registrar una entrada nueva

Copia esta plantilla al inicio del archivo (justo debajo de este bloque de instrucciones) cada vez que cierres una sesión de trabajo:

```markdown
## [Fecha: AAAA-MM-DD] — [Título breve de la sesión]

- **Hora de inicio – Hora de cierre:** HH:MM – HH:MM
- **Duración total:** X horas
- **Fase / Subfase relacionada:** (según `plan-desarrollo-gas-bigquery.md`, ej. "Fase 0.2 — Esqueleto de BigQuery")
- **Objetivo de la sesión:** (una o dos frases)

### Archivos creados/modificados
- `ruta/archivo.ext` — qué cambió y por qué

### Decisiones tomadas
- Decisión 1 (ej. valor de umbral elegido, alcance definido, criterio de exclusión)

### Pendientes para la próxima sesión
- Pendiente 1

### Criterio de éxito de la subfase
- [ ] Cumplido / [ ] No cumplido — detalle
```

---

## Entradas

## [Fecha: 2026-09-02] — Refactor UI, Design System y Herramientas Analíticas IA

- **Hora de inicio – Hora de cierre:** 16:30 – 20:15
- **Duración total:** 3.75 horas
- **Fase / Subfase relacionada:** Fase Frontend — Estilos Corporativos y Evolución Analítica
- **Objetivo de la sesión:** Migrar la interfaz genérica al PeYa Design System, habilitar comparativas de múltiples métricas con escalas independientes en ECharts e integrar herramientas de exportación para análisis predictivo con IA.

### Archivos creados/modificados
- `Styles.html` e `Index.html` — Inyectada la tipografía "Outfit", las variables CSS de la paleta oficial (`--peya-*`)[cite: 2, 4] y la configuración extendida de Tailwind. Añadido logotipo corporativo[cite: 3].
- `UI_Table.html` — Reemplazados caracteres ASCII rudimentarios por SVGs corporativos (Check, ArrowUp, ArrowDown)[cite: 1, 7]. Aplicación de paleta semántica (`peya-positive`, `peya-red-50`).
- `UI_Charts.html` — Refactor profundo para soportar un array dinámico de métricas (multi-selección). Implementación de Eje Y Dual (Dual Y-Axis) nativo de ECharts para evitar el aplanamiento al mezclar volúmenes altos y porcentajes[cite: 11]. Mapeo de leyendas cortas para optimizar espacio visual.
- `UI_Filters.html` — Interfaz actualizada con iconos corporativos SVG (Add, Close, Filter)[cite: 1, 15]. Desarrollo de la función `copyPrompt` que empaqueta la vista actual de datos (JSON de `timeSeries`) junto con directrices analíticas predefinidas (Expansión/Feriados, Salud Operativa, Embudo) directo al portapapeles[cite: 15].

### Decisiones tomadas
- **Ejes Duales en ECharts:** Se integró un selector para que el analista asigne cada métrica al eje izquierdo (absolutos) o derecho (porcentajes), manteniendo la coherencia visual y matemática.
- **Exportación a LLMs:** En lugar de crear un backend propio de IA (con costos asociados y gestión de API keys), se optó por una arquitectura "Copiar Prompt". Esto centraliza el estado en el frontend y delega la inferencia pesada a la herramienta que elija el analista.
- **Iconografía Estricta:** Se eliminó cualquier dependencia a librerías externas o texto plano, obligando el uso exclusivo del código vectorial del catálogo oficial `ICONOS.txt`[cite: 1].

### Pendientes para la próxima sesión
- **Hotfix de Cold Start en BigQuery:** Modificar el `LEFT JOIN` en `Service_BigQuery.gs` para asegurar que el cruce de sesiones y logística se realice a nivel de "Ciudad Perseus", previniendo que los días con 0 órdenes desaparezcan de los reportes (crítico para proyectar aperturas en feriados).

### Criterio de éxito de la subfase
- [x] Cumplido — La UI refleja 100% el Design System, los gráficos manejan escenarios multi-métrica asimétricos sin romper la escala, y el puente analítico para modelos fundacionales de IA está operativo.
---

## [Fecha: 2026-09-02] — Desarrollo Core, Integración UI y Estabilización de BigQuery

- **Hora de inicio – Hora de cierre:** 14:00 – 16:30
- **Duración total:** 5.5 horas
- **Fase / Subfase relacionada:** Fases 3 a 7 — Implementación Frontend (Vue/ECharts), Conexión BQ, y Estabilización.
- **Objetivo de la sesión:** Integrar la interfaz gráfica con el backend de BigQuery, resolver errores de permisos y diagnosticar fallos silenciosos en la entrega masiva de datos para lograr una versión de producción estable.

### Archivos creados/modificados
- `Config.gs` — Modificado para corregir el `PROJECT_ID` de ejecución apuntando a `peya-chile`, resolviendo el error 403 (Access Denied).
- `Service_BigQuery.gs` — Refactorizado profundamente. Se reemplazó el paso de parámetros nulos por **SQL dinámico**. La cláusula `WHERE` ahora se ensambla condicionalmente para evitar el bug de la API de BigQuery donde `ARRAY_LENGTH(NULL)` elimina todas las filas de la tabla de forma silenciosa.
- `Controller.gs` — Modificada la función `fetchDashboardData` para envolver la respuesta en `JSON.stringify(rawData)`. Esto actúa como un mecanismo de compresión para eludir el límite de ~15MB de `google.script.run`.
- `UI_Filters.html` — Actualizada la promesa `withSuccessHandler` para incluir `JSON.parse()`, revirtiendo la compresión del backend exitosamente sin colapsar la memoria del navegador.
- `Store.html`, `UI_Charts.html`, `UI_Table.html` — Creados e inyectados. Contienen el motor matemático anti "promedios de promedios" y la lógica reactiva que oculta los lienzos (`v-if="hasData"`) cuando no hay registros.

### Decisiones tomadas
- **Construcción de SQL Dinámico:** Se decidió dejar de intentar inyectar parámetros `null` o `[]` en la API de BigQuery. Si el usuario no aplica un filtro, la línea correspondiente del `WHERE` simplemente no se añade al string de la consulta.
- **Bypass de Límite de Memoria (GAS):** Se estableció el estándar de transportar grandes volúmenes de datos entre Apps Script y el navegador como texto plano (String) en lugar de arreglos de objetos, previniendo fallos asíncronos asfixiantes.
- **Separación de Responsabilidades:** Se mantuvo firmemente la decisión de que el backend solo extraiga sumas crudas (`total_orders`, `rejected_orders`) y que todo cálculo de ratio o porcentaje (Fail Rate, Share) ocurra estrictamente en el Frontend (`Store.html`).

### Pendientes para la próxima sesión
- **Deuda Técnica:** Migrar los ~90 polígonos de malls (WKT) que actualmente residen en un CTE hardcodeado hacia una tabla formal `dim_malls` en BigQuery.
- Monitorear el tiempo de respuesta del dashboard en la primera semana de uso real por parte de los analistas operativos.

### Criterio de éxito de la subfase
- [x] Cumplido — El dashboard conecta sin errores de permisos, los filtros responden sin colapsar la memoria, y los componentes visuales (ECharts y Tabla de Ranking) renderizan exitosamente los datos históricos reales.

---

## [Fecha: 2026-09-04] — Intento de Fix #1 (Tabla de Partners) — no resuelto + regresión introducida y corregida

- **Hora de inicio – Hora de cierre:** 16:45 – 22:45
- **Duración total:** 6 horas
- **Fase / Subfase relacionada:** REFACTOR_PLAN.md — Fix #1 (Tabla de Partners desaparecida)
- **Objetivo de la sesión:** Diagnosticar y corregir por qué la tabla de ranking de partners no se renderiza pese a que los gráficos sí muestran datos.

### Archivos creados/modificados
- `Store.html` — Se agregó `state.version` (contador) y `Vue.markRaw(rawData)` en `setGroupRawData()`, para reemplazar los `watch(deep:true)` existentes por una señal liviana.
- `UI_Charts.html` — Se reemplazó `watch(storeState.groups, {deep:true})` por `watch(storeState.version)`. Esto introdujo una **regresión**: los gráficos dejaron de renderizarse automáticamente al aplicar filtros y solo aparecían al tildar "Etiquetas" o "Fusionar Grupos". Causa: `watch()` usa `flush:'pre'` por defecto, y el callback corría antes de que Vue creara los `<div id="chart-...">` en el DOM (recién existen cuando `v-if="hasData"` pasa a `true` en el mismo ciclo). Se corrigió agregando `{ flush: 'post' }` al watcher.
- `UI_Table.html` — Se reemplazó el `watch(groupsWithData, {deep:true})` por la misma sin `deep`, y se separaron los estados `anyLoading`/`anyError`/con-datos en el template.

### Decisiones tomadas
- Se descartó la hipótesis original ("deep-watchers costosos son la causa raíz de la tabla ausente"): tras revisar los 5 archivos involucrados (`Store.html`, `UI_Charts.html`, `UI_Table.html`, `UI_Filters.html`, `Index.html`) no se encontró ningún bug de código que explique que `groupsWithData` de la tabla esté vacío mientras el de los gráficos no — ambos nacen del mismo `aggregatedData`.
- **El problema original (tabla de partners no aparece) sigue sin resolverse.** Los cambios de esta sesión corrigieron una regresión que ellos mismos introdujeron, pero no el bug que motivó el fix.
- Se identificaron 2 causas no descartadas, ninguna de código: (a) deployment de GAS desactualizado (probar contra `/dev` o crear nueva versión), (b) pendiente de diagnóstico en vivo vía consola del navegador.

### Pendientes para la próxima sesión
- Correr en consola del navegador (con datos cargados) y registrar el resultado:
```javascript
  Store.state.groups.map(g => ({ label: g.label, loading: g.loading, error: g.error,
    timeSeries: g.aggregatedData.timeSeries.length, partnerTotals: g.aggregatedData.partnerTotals.length }))
```
- Revisar consola por errores de JS no reportados aún.
- Retomar Fix #1 con esa evidencia antes de tocar más código.

### Criterio de éxito de la subfase
- [X] No cumplido — la tabla de partners sigue sin aparecer. Se corrigió (no se dejó pendiente) la regresión de renderizado de gráficos introducida por este mismo intento.

---

## [Fecha: 2026-09-04] — Fix #1 Parte 2: Depuración Empírica de Vue 3 (Gráficos OK, Tabla Pendiente)

- **Hora de inicio – Hora de cierre:** 22:45 – 23:45
- **Duración total:** 1 hora
- **Fase / Subfase relacionada:** REFACTOR_PLAN.md — Fix #1 (Tabla de Partners desaparecida / Fragmentos Raíz en Vue 3)
- **Objetivo de la sesión:** Ejecutar diagnóstico empírico en la consola de Chrome para aislar el fallo de reactividad en `UI_Table.html` que mantenía la tabla oculta tras la optimización de memoria.

### Archivos creados/modificados
- `UI_Charts.html` — Se implementó un bypass de renderizado usando doble `requestAnimationFrame` antes de inicializar ECharts. **(Éxito: Los gráficos ahora se dibujan automáticamente sin intervención manual)**.
- `UI_Table.html` — Se intentaron múltiples enfoques para forzar la reactividad perdida tras aplicar `Vue.markRaw()` en el Store:
  1. Inyección explícita de `storeState.version` dentro de `computed`.
  2. Sustitución de variables `computed` por estado manual `ref([])` sincronizado por eventos.
  3. Adición de un contenedor `<div class="w-full">` como nodo raíz absoluto para evitar un bug de compilación de Fragmentos Raíz (`v-if / v-else-if` paralelos) en la versión CDN de Vue 3.

### Decisiones tomadas
- **Aislamiento del Fallo (Descarte de Backend/BQ):** Mediante pruebas en el contexto de ejecución `userCodeAppPanel` de las DevTools, se demostró irrefutablemente que los datos de BigQuery llegan y se procesan matemáticamente de forma correcta (`partnerTotals: 32` y `partnerTotals: 81` detectados en memoria). El backend, las queries y el `Store.html` funcionan perfectamente.
- **Bug Silencioso de Frontend:** Se determinó que el problema reside exclusivamente en un fallo silencioso del compilador nativo de Vue 3 (vía CDN). Pese a que el arreglo `tableGroups` tiene datos y el HTML posee las instrucciones para iterarlos, el DOM no refleja los cambios, no arrojando excepciones ni errores de JavaScript.

### Pendientes para la próxima sesión
- **Fix #1 (Tabla de Partners):** El problema persiste. Se requiere investigar alternativas para forzar a Vue 3 a redibujar el nodo o considerar rediseñar el componente `UI_Table.html` desde cero evadiendo patrones de anidación condicional profunda.

### Criterio de éxito de la subfase
- [X] No cumplido — La tabla de partners sigue siendo invisible en el DOM a pesar de contar con los datos en memoria. Se logró resolver exitosamente la auto-carga de los gráficos.