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

## [Fecha: 2026-09-02] — Desarrollo Core, Integración UI y Estabilización de BigQuery

- **Hora de inicio – Hora de cierre:** 14:00 – 16:30
- **Duración total:** 5.5 horas
- **Fase / Subfase relacionada:** Fases 3 a 7 — Implementación Frontend (Vue/ECharts), Conexión BQ, y Estabilización.
- **Objetivo de la sesión:** Integrar la interfaz gráfica con el backend de BigQuery, resolver errores de permisos y diagnosticar fallos silenciosos en la entrega masiva de datos para lograr una versión de producción estable.

### Archivos creados/modificados
- `Config.gs` — Modificado para corregir el `PROJECT_ID` de ejecución apuntando a `peya-data-origins-pro`, resolviendo el error 403 (Access Denied).
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