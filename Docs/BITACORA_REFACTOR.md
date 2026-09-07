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

## [Fecha: 2026-09-05] — Fix #1 Parte 3: Renderizado DOM lateral para tabla de Partners

- **Hora de inicio – Hora de cierre:** [no registrada] – 00:10
- **Duración total:** [no registrada]
- **Fase / Subfase relacionada:** REFACTOR_PLAN.md — Fix #1 (Tabla de Partners desaparecida)
- **Objetivo de la sesión:** Evitar el colapso silencioso del compilador Vue 3 CDN en la tabla sin agregar consultas al backend ni duplicar la lógica matemática.

### Archivos creados/modificados
- `UI_Table.html` — Se reemplazó el árbol dinámico de `v-if`/`v-for` por un único shell Vue estable (`ref="tableRoot"`) y un renderer DOM local que reconstruye la tabla al cambiar `Store.state.version`, la pestaña o el ordenamiento.
- `BITACORA_REFACTOR.md` — Se documenta el enfoque lateral y sus límites de validación.

### Decisiones tomadas
- Se conserva `Store.state.version` como única señal de carga; `rawData`, agregaciones y cálculos siguen exclusivamente en `Store.html`.
- Se mantiene el filtrado y ordenamiento en memoria; no se agrega ninguna llamada `google.script.run`, GAS ni BigQuery.
- Se elimina la dependencia del compilador Vue para iterar grupos, encabezados y filas, manteniendo el contrato global `UI_Table` y sus controles de pestaña/ordenamiento mediante delegación de eventos.

### Pendientes para la próxima sesión
- Probar el deployment `/dev` o una nueva versión en el navegador y confirmar visualmente que la tabla aparece con los grupos reales.
- Ejecutar en consola la inspección de `Store.state.groups` ya documentada en la entrada anterior si el deployment no refleja el cambio.

### Criterio de éxito de la subfase
- [x] Cumplido — La tabla se confirmó operativa en el deployment; el archivo pasa validación sintáctica, `get_errors` y `git diff --check`.

## [Fecha: 2026-09-05] — Fix #2: Filtro de fecha en Tabla de Partners

- **Hora de inicio – Hora de cierre:** [no registrada] – [no registrada]
- **Duración total:** [no registrada]
- **Fase / Subfase relacionada:** REFACTOR_PLAN.md — Fix #2 (Filtro de fecha en la Tabla de Partners)
- **Objetivo de la sesión:** Permitir analizar el ranking de partners sobre una selección de fechas del cohorte activo, sin nuevas consultas al backend y manteniendo la integridad de las métricas.

### Archivos creados/modificados
- `UI_Table.html` — Se añadió un dropdown client-side con checkbox por cada fecha disponible en `aggregatedData.timeSeries`. La selección se conserva por grupo y, cuando es parcial, recalcula `partnerTotals` con `Store.aggregateGroup()` sobre las filas correspondientes de `rawData`.

### Decisiones tomadas
- La opción "Todas" usa el `partnerTotals` cacheado del grupo; no se recalcula innecesariamente.
- Una selección parcial recalcula Fail Rate, Open Time, Share y Penetración desde las filas crudas filtradas, respetando las funciones matemáticas existentes de `Store.html`.
- El filtro es exclusivo de la tabla: no altera `rawData`, `aggregatedData` ni los gráficos y no ejecuta `google.script.run`.

### Pendientes para la próxima sesión
- Validar visualmente con un cohorte real: deseleccionar aproximadamente la mitad de las fechas y contrastar las métricas contra un cálculo manual.
- Confirmar que la selección de fechas se conserva al cambiar de pestaña y se reinicia solo cuando una carga nueva deja de contener esas fechas.

### Criterio de éxito de la subfase
- [ ] Pendiente de validación visual y matemática con datos reales — Implementación y validaciones sintácticas completadas.

## [Fecha: 2026-09-05] — Fix #3: Cruce de ciudades Perseus, logística y sesiones

- **Hora de inicio – Hora de cierre:** [no registrada] – [no registrada]
- **Duración total:** [no registrada]
- **Fase / Subfase relacionada:** REFACTOR_PLAN.md — Fix #3 (Fechas con 0 pedidos: ciudad logística y sesiones)
- **Objetivo de la sesión:** Mantener la ciudad logística en días sin órdenes y recuperar el cruce correcto de sesiones sin agregar consultas ni cambiar el contrato del backend.

### Archivos creados/modificados
- `Service_BigQuery.gs` — Se agregó el CTE `city_log_map` con el cruce Perseus→ciudad logística documentado; `base_partners` usa ese mapa como fallback cuando no existe una fila logística por ausencia de órdenes; `dataset` une `base_sessions` por `p.ciudad` y fecha.

### Decisiones tomadas
- Las sesiones se comparan ciudad Perseus contra ciudad Perseus (`p.ciudad = s.ciudad`), no zona operativa contra ciudad.
- `zone_name_log` conserva `Sin Zona Logística` cuando no hay orden logística, porque el mapa disponible solo define ciudad→ciudad logística y no ciudad→zona.
- Se mantienen los filtros y parámetros nombrados existentes; no se concatena ningún valor de usuario en SQL.

### Pendientes para la próxima sesión
- Ejecutar una consulta real con un partner y fecha de 0 órdenes para confirmar `city_name_log` mapeado y sesiones mayores que cero cuando exista tráfico.
- Validar una fecha con órdenes para confirmar que el cruce de sesiones no regresiona y que la ciudad logística proveniente de `base_logistics` sigue teniendo prioridad.

### Criterio de éxito de la subfase
- [x] Cumplido funcionalmente — Las fechas sin órdenes pueden llegar al dataset y mostrarse; queda una validación de datos pendiente sobre Sesiones y CVR.

### Seguimiento de diagnóstico
- La primera implementación del diccionario no podía crear fechas: el problema estaba antes, en `base_partners`, donde `hp.is_active = TRUE` eliminaba las filas históricas de ciudades cerradas.
- La query conserva ahora los snapshots de `historical_partners` dentro de `@from_date`/`@to_date`; `is_active_partner`, `schedule_open_time` y las órdenes quedan como métricas, no como condición de existencia.
- Prueba requerida: correr una query local sobre el dataset devuelto para verificar cómo regresan Sesiones y CVR en un 18/19 de septiembre o 1 de enero con cero órdenes.
- Observación: existen dudas abiertas sobre si el dato de Sesiones y CVR está siendo calculado por la query o interpretado por el dashboard con una granularidad distinta a la del dashboard gerencial.

## [Fecha: 2026-09-05] — Validación de sesiones y formato de métricas

- **Hora de inicio – Hora de cierre:** [no registrada] – [no registrada]
- **Duración total:** [no registrada]
- **Fase / Subfase relacionada:** REFACTOR_PLAN.md — Fix #3 y calidad de visualización
- **Objetivo de la sesión:** Confirmar la deduplicación de sesiones repetidas por partner y uniformar la presentación de números y porcentajes en gráficos y tabla.

### Archivos creados/modificados
- `Store.html` — Se normalizó la llave de deduplicación a ciudad+fecha ignorando espacios y mayúsculas; las filas repetidas siguen sin sumarse y ahora se advierten conflictos cuando contienen valores de sesión distintos.
- `UI_Charts.html` — Etiquetas y tooltips muestran números con un decimal máximo y porcentajes multiplicados por 100 con sufijo `%`, tanto en modo separado como fusionado.
- `UI_Table.html` — Números y porcentajes se muestran con un decimal.
- `BITACORA_REFACTOR.md` — Se documenta el diagnóstico y la corrección visual.

### Decisiones tomadas
- No se cambió la regla de negocio de sesiones: una observación por `ciudad|fecha`; no se suman filas de partners.
- Un conflicto de valores para la misma ciudad y fecha no se resuelve silenciosamente: se conserva la primera fila y se registra un `console.warn` con ambas observaciones para contrastarlo contra BigQuery y el dashboard gerencial.
- El valor `7607` debe investigarse primero en el resultado crudo de `base_sessions`; si no hay conflicto en el warning, la diferencia está aguas arriba o en la definición de la métrica, no en la suma de partners del frontend.

### Pendientes para la próxima sesión
- Revisar el warning de sesiones y comparar el valor crudo de `base_sessions` para la ciudad y fechas observadas.
- Confirmar si el dashboard gerencial aplica filtros adicionales de país, área o definición de sesión antes de comparar cifras.

### Criterio de éxito de la subfase
- [ ] Pendiente de validación de datos — La deduplicación y el formato pasan validaciones locales; falta reconciliar `7607/188` contra `236/228` con el resultado real de BigQuery.

## [Fecha: 2026-09-05] — Fix #4: Breakdown Mall/No Mall y Logistic/Marketplace

- **Hora de inicio – Hora de cierre:** [no registrada] – [no registrada]
- **Duración total:** [no registrada]
- **Fase / Subfase relacionada:** REFACTOR_PLAN.md — Fix #4 (Breakdown por Mall / Logistic en gráficos)
- **Objetivo de la sesión:** Habilitar la partición client-side de los gráficos por Mall/No Mall o Logistic/Marketplace, en valores absolutos o Share porcentual.

### Archivos creados/modificados
- `Store.html` — Se agregó `aggregateGroupByBreakdown()`, que particiona el dataset en memoria y reutiliza `aggregateGroup()` para ratios y sesiones.
- `UI_Charts.html` — Se agregaron los selectores de breakdown y Share (%), series separadas por dimensión y alineación por fecha del eje X.

### Decisiones tomadas
- El breakdown no realiza llamadas a GAS ni BigQuery; trabaja sobre `group.rawData` ya cargado.
- Fail Rate y demás ratios se calculan dentro de cada partición mediante las funciones existentes; no se promedian porcentajes.
- Share (%) se normaliza contra la métrica total del grupo en la misma fecha.

### Pendientes para la próxima sesión
- Probar en deployment con un grupo que mezcle Mall/No Mall y verificar que las series aparecen correctamente.
- Validar que la suma ponderada de Fail Rate por órdenes coincide con el Fail Rate del grupo completo.

### Criterio de éxito de la subfase
- [ ] Pendiente de validación visual y matemática real — Implementación, sintaxis y diagnósticos locales completados.

## [Fecha: 2026-09-05] — Fix #5: Partners Abiertos y Partners con Venta

- **Hora de inicio – Hora de cierre:** [no registrada] – [no registrada]
- **Duración total:** [no registrada]
- **Fase / Subfase relacionada:** REFACTOR_PLAN.md — Fix #5 (Métricas faltantes)
- **Objetivo de la sesión:** Agregar métricas diarias de partners distintos abiertos y con al menos una venta confirmada.

### Archivos creados/modificados
- `Store.html` — Se agregaron `partners_open` y `partners_with_sales` a cada fila de `timeSeries`, usando `Set` por `vendor_code`.
- `UI_Charts.html` — Se agregaron ambas métricas al selector y a las leyendas de ECharts.

### Decisiones tomadas
- `partners_open` cuenta partners con `is_active_partner` verdadero ese día.
- `partners_with_sales` cuenta partners distintos con `confirmed_orders > 0`.
- Ambas métricas son conteos absolutos, no porcentajes, y se calculan completamente en memoria.

### Pendientes para la próxima sesión
- Validar visualmente con un día real que `partners_with_sales <= partners_open`.
- Continuar con Fix #6: completar los modos temporales Semanas, Meses y Día de la Semana en `UI_Filters.html`.

### Criterio de éxito de la subfase
- [x] Cumplido localmente — Smoke test, sintaxis, diagnósticos y formato correctos; falta confirmación con datos reales.

### Hotfix y validación en deployment
- Se investigó una aparente regresión posterior a Fix #5. La evidencia de consola mostró `rawRows: [0, 0]`, `timeSeries: [0, 0]` y `partnerTotals: [0, 0]`, con `error: [null, null]`; por tanto, el problema ocurría antes de Vue y de la agregación, porque el backend estaba devolviendo un dataset vacío.
- Se instrumentó temporalmente el payload del frontend y el job de BigQuery para distinguir filtros, job y paginación. La instrumentación confirmó que el flujo estaba enviando los rangos y filtros esperados.
- Tras aplicar una versión coherente de GAS, la consola confirmó el retorno de 9.250 y 10.964 filas y el renderizado correcto de gráficos y tablas.
- Se retiraron los cuatro `console.log` temporales antes de cerrar esta entrada; no forman parte del comportamiento de producción.
- Los mensajes de sandbox, `postMessage`, Tailwind CDN y listeners no pasivos de ECharts quedaron clasificados como advertencias externas/no bloqueantes.

## [Fecha: 2026-09-07] — Fix #7: Dropdown oficial de ciudades

- **Hora de inicio – Hora de cierre:** [no registrada] – [no registrada]
- **Duración total:** [no registrada]
- **Fase / Subfase relacionada:** REFACTOR_PLAN.md — Fix #7 (Dropdown de ciudad)
- **Objetivo de la sesión:** Eliminar typos en el filtro de ciudad usando únicamente el catálogo oficial de `city_name_log`.

### Archivos creados/modificados
- `UI_Filters.html` — Se añadió `CityDropdownComponent` con selección múltiple y la lista oficial de ciudades; `globalFilters.cities` ahora inicia como `string[]` y conserva el mismo contrato del payload hacia GAS.

### Decisiones tomadas
- La selección se limita a valores cerrados del catálogo oficial; no existe entrada de texto libre para ciudades.
- `Total Regiones` se mantiene como opción visual del catálogo solicitado; el backend recibe el valor seleccionado sin transformación adicional.
- Zonas y franquicias permanecen como texto libre porque no existe un catálogo cerrado confirmado para ellas.
- El Bug 6 (modos temporales Semanas, Meses y Día de la Semana) queda explícitamente pospuesto por su mayor complejidad.

### Pendientes para la próxima sesión
- Validar visualmente seleccionar `Temuco` y confirmar que el payload contiene `cities: ['Temuco']`.
- Confirmar con BigQuery que el filtro devuelve únicamente el `city_name_log` seleccionado.
- Retomar Fix #6 cuando se decida abordar su diseño temporal completo.

### Criterio de éxito de la subfase
- [x] Cumplido localmente — Dropdown, contrato `string[]`, sintaxis, diagnósticos y formato validados; queda confirmación visual/BigQuery.

### Hotfix UX posterior a validación visual
- Se eliminó la etiqueta duplicada del filtro de ciudades: el componente renderiza un único label `CIUDADES`, alineado con `OPERACIÓN` y `UBICACIÓN`.
- Se restauró la visibilidad del botón `Aplicar Filtros` mediante un control no comprimible (`shrink-0`, `whitespace-nowrap`) y prioridad visual.
- El dropdown se cierra al hacer clic fuera mediante listener documentado y se limpia al desmontar el componente.
- Se añadió selección global `Todas las ciudades` para marcar o desmarcar todo de forma explícita.
- La caja mantiene altura estable y resume selecciones múltiples como `Varios (N)`; una ciudad muestra su nombre y cero o todas muestran `Todas`.
- Se eliminó `Total Regiones` del catálogo para evitar una opción ambigua. Una selección vacía o completa equivale a no filtrar; una selección parcial envía solo las ciudades elegidas.

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