# REFACTOR_PLAN.md — Dates Analytics Log
### Post-MVP: 5 issues técnicos, diagnóstico y diseño de solución

---

## 0. Contexto

Revisé `PROJECT_MAP.md` (código fuente completo vía repomix) y `BITACORA_REFACTOR.md`. El proyecto avanzó más allá de lo que construimos juntos en este chat: rediseño con el Design System de PeYa, SQL dinámico en vez de parámetros nulos, `JSON.stringify`/`JSON.parse` como bypass del límite de `google.script.run`, y un puente "Copiar Prompt" para análisis con IA externa. Todo eso queda intacto — este plan solo toca lo necesario para resolver los 5 puntos que reportaste.

Archivos que este refactor va a tocar: `Service_BigQuery.gs`, `Store.html`, `UI_Filters.html`, `UI_Charts.html`, `UI_Table.html`. Ninguno de `Config.gs`, `Controller.gs`, `Main.gs`.

---

## 1. Los Graficos no renderizan los datos automaticamente (hay que cliquear los checkboxes para que aparezcan) y la Tabla de Partners desapareció (en las primeras fases se desplegaba sin problemas, hasta el último refactor)

### Diagnóstico
Revisé `UI_Table.html` a fondo: `groupsWithData` filtra por `g.aggregatedData.partnerTotals.length > 0`, y `partnerTotals` se calcula en el **mismo** `aggregateGroup(rawData)` que produce `timeSeries` (el que sí renderiza en `UI_Charts`). Estructuralmente, si `timeSeries` tiene datos, `partnerTotals` también debería tenerlos — no encontré un bug de lógica que explique un vacío selectivo.

Lo que sí encontré, y es mi hipótesis principal: **`UI_Charts.html` y `UI_Table.html` tienen cada uno su propio `watch(() => storeState.groups, ..., { deep: true })`**. Con el dataset real (rango de meses × todas las ciudades × todos los partners, fácilmente decenas de miles de filas por grupo dentro de `rawData`), un *deep watcher* de Vue sobre ese árbol reactivo completo es carísimo: Vue tiene que recorrer recursivamente cada fila de `rawData` de cada grupo en cada mutación. Con volumen real esto puede:
- colgar el hilo principal el tiempo suficiente para que el usuario perciba que "no cargó",
- o, en el peor caso, disparar un error de profundidad de recursión que aborta silenciosamente el render de ese componente sin tumbar el resto de la página (el `<ui-filters>` y `<ui-charts>` no comparten el mismo watcher, así que siguen funcionando).

Es una hipótesis, no una certeza sin verla en vivo — pero el fix que propongo es buena práctica de todas formas, con o sin esta causa exacta.

### Fix propuesto
1. **Eliminar la reactividad profunda sobre `rawData`.** `rawData` es el dataset crudo — nadie necesita reaccionar campo por campo a sus cambios, solo saber "este grupo tiene datos nuevos". En `Store.html`, envolver `rawData` con `Vue.markRaw()` al asignarlo en `setGroupRawData()`:
   ```js
   function setGroupRawData(groupId, rawData) {
     const group = getGroup(groupId);
     if (!group) throw new Error('Grupo no encontrado: ' + groupId);
     group.rawData = Vue.markRaw(rawData); // ya no es reactivo fila por fila
     group.aggregatedData = aggregateGroup(rawData);
   }
   ```
   `markRaw` le dice a Vue "no conviertas esto en reactivo" — sigue siendo un array JS normal, se puede leer y filtrar sin problema, pero deja de costar nada en un `watch` profundo.

2. **Cambiar los `watch(deep:true)` de `UI_Charts.html` y `UI_Table.html` por una señal liviana.** En vez de vigilar todo `storeState.groups`, agregar un contador de versión en `Store.html`:
   ```js
   const state = reactive({ groups: [], version: 0 });
   function setGroupRawData(groupId, rawData) {
     // ...
     state.version++; // se incrementa una vez por carga, no por cada campo interno
   }
   ```
   y en los componentes:
   ```js
   watch(() => storeState.version, () => renderCharts()); // sin deep
   ```
   Esto dispara el re-render exactamente cuando corresponde (después de `setGroupRawData`), sin que Vue tenga que diferenciar qué cambió adentro del árbol.

3. **Separar los 3 estados posibles en `UI_Table.html`** (cargando / error / vacío-real / con-datos), para que un futuro fallo silencioso sea visible en vez de "la tabla no está":
   ```html
   <div v-if="anyLoading">Cargando…</div>
   <div v-else-if="anyError" class="text-red-600">{{ firstError }}</div>
   <div v-else-if="groupsWithData.length === 0">No hay partners para los filtros/fechas actuales.</div>
   <div v-else><!-- tabla actual --></div>
   ```

### Criterio de éxito
Cargar un grupo con rango de 1 mes completo (dataset grande, el caso que hoy falla) y confirmar que la tabla aparece sin recargar la página ni esperar más de 1-2 segundos tras el fin de la carga.

---

## 2. Filtro de fecha en la Tabla de Partners

### Requisito
Un dropdown/checkbox de fechas en `UI_Table.html` que **solo** ofrezca las fechas que ya trajo el cohorte activo (no un date-picker libre), y que al deseleccionar fechas, la tabla recalcule Fail Rate/Open Time/Share/Penetración **solo con esas fechas** — nunca promediando ratios ya calculados.

### Diseño técnico
Esto ya lo resuelve la arquitectura existente sin tocar el backend: `Store.aggregateGroup()` es una función pura que recibe un array de filas y devuelve `partnerTotals` recalculado correctamente (ratios, share, penetración). Solo hay que llamarla de nuevo con un subconjunto de `group.rawData` filtrado por fecha, en vez de leer el `partnerTotals` cacheado del grupo completo.

**`UI_Table.html` — nuevo estado y computed:**
```js
const selectedDates = reactive({}); // { [groupId]: Set<string> | null (null = todas) }

const availableDates = computed(() => {
  const group = activeGroup.value;
  if (!group) return [];
  return group.aggregatedData.timeSeries.map(d => d.fecha); // ya ordenadas
});

const activePartnerTotals = computed(() => {
  const group = activeGroup.value;
  if (!group) return [];
  const selected = selectedDates[group.id];
  if (!selected || selected.size === availableDates.value.length) {
    return group.aggregatedData.partnerTotals; // sin filtro: usa el cacheado, cero recálculo
  }
  const filteredRawData = group.rawData.filter(r => selected.has(r.fecha));
  return Store.aggregateGroup(filteredRawData).partnerTotals; // recalculado en memoria, sin ir al servidor
});
```

**UI (dropdown con checkboxes):**
```html
<div class="relative">
  <button @click="dateDropdownOpen = !dateDropdownOpen" class="...">
    Fechas: {{ selectedCount }}/{{ availableDates.length }}
  </button>
  <div v-if="dateDropdownOpen" class="absolute z-20 bg-white border rounded-lg shadow-lg p-2 max-h-64 overflow-y-auto">
    <label class="flex items-center gap-2 text-xs font-semibold border-b pb-1 mb-1">
      <input type="checkbox" :checked="allSelected" @change="toggleAll" /> Todas
    </label>
    <label v-for="fecha in availableDates" :key="fecha" class="flex items-center gap-2 text-xs py-0.5">
      <input type="checkbox" :checked="isDateSelected(fecha)" @change="toggleDate(fecha)" /> {{ fecha }}
    </label>
  </div>
</div>
```

Reemplazar `sortedPartners` para que ordene sobre `activePartnerTotals` en vez de `activeGroupData` (el `partnerTotals` fijo que usa hoy).

### Nota de diseño
El filtro de fecha vive **solo en la tabla** — no toca `group.rawData` ni afecta los gráficos, que siguen mostrando la serie temporal completa del cohorte. Si más adelante quieres que el filtro de fecha de la tabla también recorte los gráficos, es la misma función (`Store.aggregateGroup` sobre subset) aplicada a `timeSeries` en vez de `partnerTotals` — pero no lo agrego ahora porque no lo pediste y cambia el comportamiento esperado de "Aplicar".

### Criterio de éxito
Deseleccionar la mitad de las fechas de un cohorte y confirmar que Fail Rate/Share/Penetración de la tabla cambian a valores consistentes con un cálculo manual sobre esas fechas — no que la tabla simplemente oculte filas.

---

## 3. Fechas con 0 pedidos: falta city_name_log, zone_name_log y sesiones

### Diagnóstico (dos bugs distintos, aunque se ven como uno)

**Bug A — `city_name_log`/`zone_name_log` dependen de que haya órdenes.**
En `base_logistics` (Service_BigQuery.gs), `city_name_log`/`zone_name_log` salen de un `INNER JOIN` con `fact_orders` — sin órdenes ese día, no hay fila de `base_logistics`, y `dataset` cae al `COALESCE(..., 'Sin Zona Logística')`. Esto es 100% coherente con lo que reportas.

**Bug B — Sesiones tampoco aparecen, por una razón distinta: el join usa la llave equivocada.**
```sql
FROM base_partners p
LEFT JOIN base_sessions s ON p.zone_name = s.ciudad AND p.fecha = s.fecha
```
`p.zone_name` viene de `da.area_name` (`dim_area`, la zona operativa/logística), pero `s.ciudad` viene de `s.area.area_name` (el área de sesión de Perseus, cara al consumidor). Son dos taxonomías distintas — el join compara nombres que en general **no coinciden**, con o sin órdenes ese día. Esto probablemente también está perdiendo sesiones en días CON órdenes, no solo en los de 0.

### ⚠️ Hallazgo sobre `country_id` de Perseus — matizado con tu respuesta
Revisando el CSV que subiste (`Cluster_C_-_Managment_-_PERSEUS.csv`, ~1.390 ciudades), encontré que decenas de filas etiquetadas `Country ID: 2, Country Name: Chile` son ciudades de **al menos 7 países distintos que no son Chile**: `Arequipa`/`Callao`/`Chiclayo`/`Trujillo` (Perú), `Barquisimeto` (Venezuela), `Choluteca`/`Comayagua` (Honduras), `Colón`/`David`/`Tocumen` (Panamá), `Riobamba` (Ecuador), `San Salvador`/`Sonsonate` (El Salvador), `Sucre` (Bolivia), `Xela` (Guatemala).

Confirmas que `country_id = 2` es correcto en Perseus para Chile, y vas a validar manualmente que no traiga data cruzada. Tu punto sobre el matching es válido y reduce bastante el riesgo real: como `city_log_map` cruza por **nombre exacto** de ciudad, `city_total_sessions_raw` nunca va a sumar sesiones de "Quito" (Ecuador) bajo "Quilpué" — son strings distintos, no hay colisión. El riesgo residual queda acotado a nombres de ciudad genéricos que sí podrían repetirse entre países (`San Antonio`, `San Fernando`, `Santa Cruz`, `Colina`, `Santiago` existen como topónimos en más de un país de habla hispana) — si tu prueba manual filtra por `country_id = 2` y aun así aparece una de esas ciudades con un volumen de sesiones que no tiene sentido para Chile, ahí es donde vale la pena mirar con más detalle. Bajo esa aclaración, ya no lo trato como bloqueante — lo dejo en tu validación manual y saco el paso 0 del orden de implementación.

### Aclaración de arquitectura (confirmada, no cambia código): sesiones nunca se anclan a partner
Confirmaste que Perseus no registra sesiones por partner — una sesión es "alguien abrió la app", y recién en CVR2 (shop details) hay una noción de local específico. Esto es coherente con cómo `base_sessions` ya está construido (agrupa por `área + fecha`, nunca por partner) y con por qué `Store.html` necesita desduplicar por `ciudad+fecha` en vez de sumar por fila — cada partner de una ciudad "hereda" el mismo número de sesiones de su ciudad ese día porque el dato nunca existió a nivel partner. Dejo esto documentado explícitamente en el código (comentario en `base_sessions`) para que nadie intente en el futuro "arreglar" esto uniendo sesiones por `partner_id` — no hay tal columna en el dato fuente.

 cambiar la llave del join de `zone_name` a `ciudad` — ambos lados deben ser la ciudad Perseus, comparando lo mismo contra lo mismo:
```sql
LEFT JOIN base_sessions s ON p.ciudad = s.ciudad AND p.fecha = s.fecha
```
`p.ciudad` (`dp.city.name`) sale de `dim_partner` vía la fila de `hp` (historical_partners), que existe todos los días para todo partner activo — con o sin órdenes. Con este cambio, las sesiones aparecen siempre que la ciudad Perseus del partner coincida con la de la sesión, independiente de si hubo pedidos.

`Open Time` (`plan_open_time_minutes`/`real_open_time_minutes`) ya viene de `hp` vía `LEFT JOIN`, sin depender de `fo` — **ya funciona hoy para días sin órdenes**, no necesita cambio. Lo confirmo para que no se investigue algo que no está roto.

**Fix A: tabla de cruce estática Perseus → Log, como CTE, en 2 niveles.**

**Nivel 1 — las 36 ciudades logísticas**, con los 3 conflictos ya resueltos.

**Nivel 2 — extensiones metropolitanas**, cruzando tu tabla original con el CSV de Perseus (`Cluster_C_-_Managment_-_PERSEUS.csv`). Solo incluyo las que (a) son satélites geográficos ampliamente conocidos de una de las 36 ciudades — ej. "Gran Concepción" incluye oficialmente Talcahuano, Coronel, Tomé, Chiguayante, Hualpén, Penco, San Pedro de la Paz — y (b) aparecen efectivamente en tu CSV, para no inventar ciudades que Perseus nunca reporta.

```sql
city_log_map AS (
  -- GROUP BY + ANY_VALUE() se mantiene como salvaguarda defensiva: si en el
  -- futuro se agrega una ciudad nueva con una fila duplicada por error, la
  -- query sigue corriendo (con un resultado ambiguo pero visible) en vez de
  -- fallar. Con los conflictos ya resueltos (incluido Tomé -> Concepcion),
  -- hoy cada ciudad_perseus mapea a un único city_name_log.
  SELECT ciudad_perseus, ANY_VALUE(city_name_log) AS city_name_log
  FROM UNNEST([
    -- Nivel 1: las 36 ciudades logísticas (match directo, conflictos resueltos)
    STRUCT('Antofagasta' AS ciudad_perseus, 'Antofagasta' AS city_name_log),
    STRUCT('Arica', 'Arica'),
    STRUCT('Buin', 'Buin'),
    STRUCT('Linderos', 'Buin'),
    STRUCT('Calama', 'Calama'),
    STRUCT('Castro', 'Castro'),
    STRUCT('Chillán', 'Chillan'),
    STRUCT('Batuco', 'Colina'),
    STRUCT('Gran Concepción', 'Concepcion'),
    STRUCT('Copiapó', 'Copiapo'),
    STRUCT('Coyhaique', 'Coyhaique'),
    STRUCT('Curicó', 'Curico'),
    STRUCT('Iquique', 'Iquique'),
    STRUCT('Coquimbo', 'La serena'),
    STRUCT('La Serena', 'La serena'),
    STRUCT('Olmué', 'Limache'),
    STRUCT('Linares', 'Linares'),
    STRUCT('Los Ángeles', 'Los angeles'),
    STRUCT('Maitencillo', 'Maitencillo'),
    STRUCT('Zapallar', 'Maitencillo'),
    STRUCT('Melipilla', 'Melipilla'),
    STRUCT('Osorno', 'Osorno'),
    STRUCT('Ovalle', 'Ovalle'),
    STRUCT('Peñaflor', 'Penaflor'),
    STRUCT('Talagante', 'Penaflor'),
    STRUCT('Pucón', 'Pucon'),
    STRUCT('Pucon', 'Pucon'),
    STRUCT('Puerto Montt', 'Puerto montt'),
    STRUCT('Puerto Varas', 'Puerto varas'),
    STRUCT('Punta Arenas', 'Punta arenas'),
    STRUCT('Hijuelas', 'Quillota'),
    STRUCT('La Calera', 'Quillota'),
    STRUCT('Quillota', 'Quillota'),
    STRUCT('Rancagua', 'Rancagua'),
    STRUCT('Santo Domingo Oeste', 'San antonio'),
    STRUCT('San Antonio', 'San antonio'),
    STRUCT('Santo Domingo', 'San antonio'),
    STRUCT('Los Andes', 'San felipe  los andes'),
    STRUCT('San Felipe', 'San felipe  los andes'),
    STRUCT('San Fernando', 'San fernando'),
    STRUCT('Santa Cruz', 'Santa cruz'),
    STRUCT('Colina', 'Santiago'),
    STRUCT('Algarrobo', 'Sin Zona Logística'),
    STRUCT('El Quisco', 'Sin Zona Logística'),
    STRUCT('Frutillar', 'Sin Zona Logística'),
    STRUCT('Illapel', 'Sin Zona Logística'),
    STRUCT('La Ligua', 'Sin Zona Logística'),
    STRUCT('Nacimiento', 'Sin Zona Logística'),
    STRUCT('Pichilemu', 'Sin Zona Logística'),
    STRUCT('Quintero', 'Sin Zona Logística'),
    STRUCT('Santiago', 'Santiago'),
    STRUCT('Talca', 'Talca'),
    STRUCT('Temuco', 'Temuco'),
    STRUCT('Valdivia', 'Valdivia'),
    STRUCT('Vallenar', 'Vallenar'),
    STRUCT('Villarrica', 'Villarrica'),
    STRUCT('Concón', 'Vina del mar'),
    STRUCT('Quilpué', 'Vina del mar'),
    STRUCT('Valparaíso', 'Vina del mar'),
    STRUCT('Villa Alemana', 'Vina del mar'),
    STRUCT('Viña del Mar', 'Vina del mar'),

    -- Nivel 2: extensiones metropolitanas confirmadas en tu CSV de Perseus
    -- (área metropolitana de Concepción = "Gran Concepción")
    STRUCT('Concepción', 'Concepcion'),
    STRUCT('Talcahuano', 'Concepcion'),
    STRUCT('Coronel', 'Concepcion'),
    STRUCT('Chiguayante', 'Concepcion'),
    STRUCT('Hualpén', 'Concepcion'),
    STRUCT('Penco', 'Concepcion'),
    STRUCT('San Pedro de la Paz', 'Concepcion'),
    STRUCT('Tomé', 'Concepcion'), -- confirmado: Tomé es Gran Concepción, no 'Sin Zona Logística'
    -- (satélites de Temuco, mencionaste "Easton, Padre las Casas, etc.")
    STRUCT('Padre Las Casas', 'Temuco'),
    STRUCT('Vilcún', 'Temuco'),
    STRUCT('Nueva Imperial', 'Temuco'),
    STRUCT('Carahue', 'Temuco'),
    -- (satélite de Valdivia)
    STRUCT('Panguipulli', 'Valdivia')
  ])
  GROUP BY ciudad_perseus
)
```

### ⚠️ No incluí "Easton"
Lo mencionas como ejemplo de satélite de Temuco, pero no aparece en tu CSV de Perseus con ese nombre exacto — probablemente Perseus lo registra bajo el nombre de la comuna (`Temuco`) y no como un mall/sector aparte, a diferencia de cómo sí aparece en el CTE de `malls` de `Service_BigQuery.gs`. No hay nada que mapear ahí por ahora; si en un futuro Perseus reporta "Easton" como área propia, se agrega con una línea más al Nivel 2.

### Fuera de alcance deliberadamente: comunas de Santiago
Tu CSV trae decenas de localidades que corresponden a comunas de Santiago (ej. `San Miguel`, `San Ramón`, `La Cisterna`), pero **no las mapeo una por una**, por dos razones: (1) son ~50+ comunas, mucho volumen para mantener a mano, y (2) varias comparten nombre con localidades de otros países (ver el hallazgo de `country_id` arriba) — mapear por nombre sin verificar país es peligroso. Dos rutas antes de intentarlo:
- **Opción A (más simple):** cualquier `ciudad_perseus` que no matchee cae en `'Sin Zona Logística'` — es el comportamiento actual del `COALESCE`, no se pierde nada, solo no se gana granularidad extra dentro de Santiago.
- **Opción B (más robusta, mayor esfuerzo):** migrar el matching de nombre-de-ciudad a polígonos geográficos (lat/long), igual que ya hacen con los malls en `Service_BigQuery.gs` — evita el problema de colisión de nombres entre países.

En `base_partners`, agrego el join y en `dataset` cambio el `COALESCE`:
```sql
LEFT JOIN city_log_map clm ON LOWER(TRIM(dp.city.name)) = LOWER(TRIM(clm.ciudad_perseus))
```
```sql
-- en dataset:
COALESCE(p.city_name_log, clm.city_name_log, 'Sin Zona Logística') AS city_name_log,
-- zone_name_log se queda en 'Sin Zona Logística' para días sin órdenes:
-- la tabla que diste mapea a nivel CIUDAD, no hay equivalente de zona.
-- Si quieres ese detalle también, hace falta una segunda tabla de cruce
-- ciudad_perseus -> zone_name_log (no la tengo).
```

### ✅ Conflictos originales — resueltos
Confirmaste las 3 resoluciones y ya están aplicadas en el CTE de arriba:
1. **`Talagante`** → `Penaflor` (se eliminó la fila duplicada que apuntaba a `Santiago`).
2. **`Villa Alemana`** → `Vina del mar` (se eliminó la fila duplicada que apuntaba a `Santiago`).
3. **`Santiago`** → `Santiago` (era un error de tipeo apuntar a `Talca`; `Talca → Talca` se mantiene sin cambios).
4. **`Tomé`** → `Concepcion` (comuna del Gran Concepción; se eliminó la fila que la dejaba en `Sin Zona Logística`).

No quedan conflictos pendientes en la tabla de cruce.

### Criterio de éxito
Elegir un partner con un día histórico de 0 órdenes (feriado, cierre) y confirmar que esa fila en el dataset trae `city_name_log` correcto (no "Sin Zona Logística") y `city_total_sessions_raw` > 0 si hubo tráfico en la ciudad ese día.

---

## 4. Breakdown por Mall / Logistic en los gráficos

### Requisito
Poder dividir (o filtrar) una métrica de un grupo por `is_mall` o `is_logistic_marketplace`, en valores absolutos o como Share (%) — tal como estaba en el `DATA_SHEET.md` original y nunca se implementó.

### Por qué esto no se resuelve con los filtros que ya existen
Hoy `isMall`/`logisticMarketplace` son filtros **de grupo** (van al backend, en `fetchDashboardData`): si los usas, filtras qué entra al grupo, pero no puedes ver "Mall vs No-Mall" **dentro** del mismo grupo/gráfico a la vez. El breakdown que pides es una partición client-side de un único grupo ya cargado — no requiere ir a BigQuery de nuevo.

### Diseño técnico

**Nueva función en `Store.html`**, junto a `aggregateGroup`:
```js
/**
 * Como aggregateGroup(), pero parte el timeSeries por el valor de una
 * dimensión categórica (is_mall o is_logistic_marketplace) en vez de
 * colapsar todo el grupo en una sola serie.
 * @return { [valorDimension]: timeSeries[] }  ej: { 'true': [...], 'false': [...] }
 */
function aggregateGroupByBreakdown(rawData, dimensionKey) {
  if (!rawData || rawData.length === 0) return {};

  const byDimension = new Map();
  rawData.forEach(function (row) {
    const key = String(row[dimensionKey]);
    if (!byDimension.has(key)) byDimension.set(key, []);
    byDimension.get(key).push(row);
  });

  const result = {};
  byDimension.forEach(function (rows, key) {
    result[key] = aggregateGroup(rows).timeSeries; // reutiliza TODA la lógica de ratios/dedupe existente
  });
  return result;
}
```
Nada de esto reinventa cálculo: reutiliza `aggregateGroup()` tal cual, solo sobre un subconjunto de filas por valor de la dimensión — así el Fail Rate de "Mall" sigue siendo `SUM(rejected)/SUM(total)` **dentro** del subconjunto Mall, no un promedio de porcentajes.

**En `UI_Charts.html`**, agregar al panel de configuración un selector por gráfico:
```html
<select v-model="config.breakdown">
  <option :value="null">Sin desglose</option>
  <option value="is_mall">Mall / No Mall</option>
  <option value="is_logistic_marketplace">Logistic / Marketplace</option>
</select>
<label v-if="config.breakdown">
  <input type="checkbox" v-model="config.breakdownAsShare" /> Mostrar como Share (%)
</label>
```
Y en `renderCharts()`, cuando `config.breakdown` no es null: por cada grupo, llamar `Store.aggregateGroupByBreakdown(group.rawData, config.breakdown)` y generar una serie ECharts por valor de la dimensión (ej. "Grupo A · Mall", "Grupo A · No Mall") en vez de una sola serie para el grupo completo. Si `breakdownAsShare` está activo, cada punto se normaliza contra el total del grupo ese día (que ya tienes en `group.aggregatedData.timeSeries`, sin recalcular):
```js
const shareValue = breakdownPoint.total_orders / groupTotalPointForThatDate.total_orders;
```

### Criterio de éxito
Con un grupo que mezcle partners de mall y de calle, activar el breakdown por `is_mall` y confirmar que Fail Rate de "Mall" y "No Mall" suman correctamente hacia el Fail Rate del grupo completo cuando se ponderan por volumen de órdenes (no un simple promedio de ambos).

---

## 5. Métricas faltantes: N Partners Abiertos y N Partners con Venta

### Requisito
Dos métricas nuevas a nivel de grupo/fecha (no a nivel de partner individual): cuántos partners estuvieron abiertos ese día y cuántos tuvieron al menos una orden confirmada — proxy de choice/oferta real para el usuario.

### Diseño técnico
Van en `timeSeries` (una por fecha), no en `partnerTotals` — son conteos de partners **distintos**, no sumas. En `aggregateGroup()`, dentro del `.map()` que arma cada fila de `timeSeries`:

```js
const partnersOpenSet = new Set();
const partnersWithSalesSet = new Set();
rowsOfDate.forEach(function (r) {
  if (r.is_active_partner) partnersOpenSet.add(r.vendor_code);       // "abierto" = tuvo horario programado ese día
  if (r.confirmed_orders > 0) partnersWithSalesSet.add(r.vendor_code); // "con venta" = al menos 1 orden confirmada
});

return {
  fecha: fecha,
  // ... resto de campos existentes ...
  partners_open: partnersOpenSet.size,
  partners_with_sales: partnersWithSalesSet.size
};
```

`is_active_partner` ya existe en el dataset (`Service_BigQuery.gs`: `MAX(CASE WHEN COALESCE(hp.schedule_open_time, 0) > 0 THEN 1 ELSE 0 END)`), así que no requiere cambios de SQL — solo agregarlo en Store.html, que hoy no lo usa para nada.

**En `UI_Charts.html`**, agregar al `<select>` de métricas:
```html
<option value="partners_open">N° Partners Abiertos</option>
<option value="partners_with_sales">N° Partners con Venta</option>
```
Y en `formatValue()`, estos dos van con `toLocaleString('es-CL')` (son conteos enteros, no `%`) — ya caen en el `else` por defecto de la función actual, no hace falta tocarla.

### Criterio de éxito
Para un día con 50 partners activos en el dataset, `partners_open` no debería superar 50, y `partners_with_sales` no debería superar `partners_open` — es una validación de sanity check rápida antes de confiar en el número.

---

## 6. Filtros temporales incompletos: solo "Fechas Específicas" funciona

### Diagnóstico
Confirmado en `UI_Filters.html` actual: el `<select v-model="group.ui.timeMode">` ofrece 4 modos (`dates`, `weeks`, `months`, `dow`), pero solo `dates` tiene inputs reales conectados a `group.rangoTemporal.fromDate/toDate`. Los otros 3 caen en este placeholder:
```html
<div v-else class="text-xs ...">
  * El modo <b>{{ group.ui.timeMode }}</b> requiere lógica auxiliar para mapear a fromDate/toDate.
</div>
```
Es decir: hoy se puede *seleccionar* "Semanas", "Meses" o "Día de la Semana" en el dropdown, pero no hay ningún input para especificar cuáles, y `aplicarFiltros()` de todas formas solo lee `group.rangoTemporal.fromDate/toDate` — que quedan vacíos o con el valor que hayan tenido de antes. Esto confirma exactamente lo que reportas: los otros 3 modos temporales no están implementados, no es un bug de un cálculo que falla, es funcionalidad que nunca se terminó de conectar en este último refactor.

### Diseño de la solución
La arquitectura correcta es la misma para los 3 modos: **traducir la selección del usuario a un rango `fromDate`/`toDate` (el único formato que entiende `Controller.fetchDashboardData`) más un `Set` opcional de fechas exactas permitidas**, para filtrar en memoria las fechas "de relleno" que caen dentro del rango pero no fueron seleccionadas (ej. si eliges solo los viernes de 3 semanas, el rango fromDate-toDate abarca esas 3 semanas completas, pero solo los viernes deben quedar en `rawData` antes de agregarse).

**Helpers de fecha** (nuevos, sin dependencias externas — van en `UI_Filters.html`):
```js
function isoWeekToDate_(year, week, weekdayIso) {
  // weekdayIso: 1=Lunes ... 7=Domingo
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay() || 7;
  const monday = new Date(simple);
  monday.setUTCDate(simple.getUTCDate() - dow + 1);
  const result = new Date(monday);
  result.setUTCDate(monday.getUTCDate() + (weekdayIso - 1));
  return result;
}
function fmtDate_(d) { return d.toISOString().slice(0, 10); }

/**
 * El usuario nunca escribe un número de semana ISO — elige cualquier fecha
 * en un <input type="date"> y esto calcula a qué semana ISO pertenece.
 * @return {year, week}
 */
function dateToISOWeek_(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // mueve al jueves de esa semana ISO
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week: week };
}

function parseMonthTokens_(str) {
  // "2026-01, 2026-03" -> ['2026-01', '2026-03']
  if (!str) return [];
  return str.split(',').map(t => t.trim()).filter(t => /^\d{4}-\d{2}$/.test(t));
}

/** @return { fromDate, toDate, allowedDates: Set<string>|null } */
function computeDateRange(group) {
  const mode = group.ui.timeMode;
  const rt = group.rangoTemporal;

  if (mode === 'dates') {
    return { fromDate: rt.fromDate || null, toDate: rt.toDate || null, allowedDates: null };
  }

  if (mode === 'dow') { // Día de la semana + semanas elegidas en el calendario
    const weeks = rt.weeks || []; // [{year, week}, ...] — ya no viene de texto, viene del date-picker
    const weekdays = rt.weekdays || []; // [1..7]
    const dates = [];
    weeks.forEach(w => weekdays.forEach(wd => dates.push(isoWeekToDate_(w.year, w.week, wd))));
    if (dates.length === 0) return { fromDate: null, toDate: null, allowedDates: new Set() };
    const sorted = dates.slice().sort((a, b) => a - b);
    return { fromDate: fmtDate_(sorted[0]), toDate: fmtDate_(sorted.at(-1)), allowedDates: new Set(dates.map(fmtDate_)) };
  }

  if (mode === 'weeks') { // Semanas ISO completas (lunes a domingo), elegidas en el calendario
    const weeks = rt.weeks || [];
    const dates = [];
    weeks.forEach(w => { for (let wd = 1; wd <= 7; wd++) dates.push(isoWeekToDate_(w.year, w.week, wd)); });
    if (dates.length === 0) return { fromDate: null, toDate: null, allowedDates: new Set() };
    const sorted = dates.slice().sort((a, b) => a - b);
    return { fromDate: fmtDate_(sorted[0]), toDate: fmtDate_(sorted.at(-1)), allowedDates: new Set(dates.map(fmtDate_)) };
  }

  if (mode === 'months') {
    const months = parseMonthTokens_(rt.monthsToken);
    if (months.length === 0) return { fromDate: null, toDate: null, allowedDates: new Set() };
    const dates = [];
    months.forEach(m => {
      const [y, mo] = m.split('-').map(Number);
      const first = new Date(Date.UTC(y, mo - 1, 1));
      const last = new Date(Date.UTC(y, mo, 0)); // último día del mes
      for (let d = new Date(first); d <= last; d.setUTCDate(d.getUTCDate() + 1)) dates.push(new Date(d));
    });
    const sorted = dates.slice().sort((a, b) => a - b);
    return { fromDate: fmtDate_(sorted[0]), toDate: fmtDate_(sorted.at(-1)), allowedDates: new Set(dates.map(fmtDate_)) };
  }

  throw new Error('Modo de rango temporal desconocido: ' + mode);
}
```

**UI que reemplaza el placeholder** — selector de calendario, no texto libre: el usuario elige cualquier día de la semana que le interesa y el sistema calcula sola la semana ISO + año, mostrada como chip legible (con el rango real de fechas, no el número de semana):
```html
<div v-if="group.ui.timeMode === 'dow'" class="space-y-2">
  <div class="flex gap-2 flex-wrap">
    <label v-for="d in weekdayOptions" :key="d.value" class="flex items-center gap-1 text-[11px] text-peya-navy-70">
      <input type="checkbox" :value="d.value" v-model="group.rangoTemporal.weekdays" /> {{ d.label }}
    </label>
  </div>
  <week-picker v-model="group.rangoTemporal.weeks"></week-picker>
</div>
<div v-else-if="group.ui.timeMode === 'weeks'">
  <week-picker v-model="group.rangoTemporal.weeks"></week-picker>
</div>
<div v-else-if="group.ui.timeMode === 'months'">
  <input type="text" v-model="group.rangoTemporal.monthsToken" placeholder="Meses: 2026-01, 2026-03"
         class="w-full text-xs border-slate-300 rounded p-1" />
</div>
```

**Nuevo componente `week-picker`** (chico, reutilizable entre los modos `weeks` y `dow`):
```js
const WeekPickerComponent = {
  props: ['modelValue'], // modelValue: [{year, week}, ...]
  emits: ['update:modelValue'],
  template: `
    <div>
      <input type="date" @change="addFromDate($event.target.value); $event.target.value = ''"
             class="text-xs border-slate-300 rounded p-1" />
      <span class="text-[10px] text-peya-navy-50 ml-1">Elige cualquier día de la semana que quieres agregar</span>
      <div class="flex flex-wrap gap-1 mt-1">
        <span v-for="(w, i) in weeksDisplay" :key="w.key"
              class="bg-peya-red-50 text-peya-red-700 text-[11px] px-2 py-0.5 rounded-full flex items-center gap-1">
          {{ w.label }}
          <button @click="remove(i)" class="leading-none">×</button>
        </span>
      </div>
    </div>
  `,
  computed: {
    weeksDisplay() {
      return this.modelValue.map(w => {
        const monday = isoWeekToDate_(w.year, w.week, 1);
        const sunday = isoWeekToDate_(w.year, w.week, 7);
        const fmt = d => d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
        return { key: w.year + '-' + w.week, label: 'Sem ' + w.week + ' · ' + fmt(monday) + '-' + fmt(sunday) };
      });
    }
  },
  methods: {
    addFromDate(dateStr) {
      if (!dateStr) return;
      const w = dateToISOWeek_(dateStr);
      const exists = this.modelValue.some(x => x.year === w.year && x.week === w.week);
      if (!exists) this.$emit('update:modelValue', this.modelValue.concat([w]));
    },
    remove(i) {
      const copy = this.modelValue.slice();
      copy.splice(i, 1);
      this.$emit('update:modelValue', copy);
    }
  }
};
```
Con esto, alguien que quiere comparar "la semana del 17 de septiembre de 2024" simplemente abre el calendario, hace clic en cualquier día de esa semana (el 15, el 17, el 21, da igual), y el chip aparece como "Sem 38 · 15 sep-21 sep" — nunca tiene que saber que es la semana ISO 38.


**Cambio en `aplicarFiltros()`** — hoy arma `reqPayload` leyendo directo `group.rangoTemporal.fromDate/toDate`; pasa a usar `computeDateRange(group)` y a filtrar el resultado antes de guardarlo en el Store:
```js
const range = computeDateRange(group);
if (!range.fromDate || !range.toDate) {
  group.error = 'Rango temporal incompleto para el modo "' + group.ui.timeMode + '".';
  group.loading = false;
  return; // no llama al backend con fechas inválidas
}
const reqPayload = { ...payloadBase, fromDate: range.fromDate, toDate: range.toDate };

google.script.run
  .withSuccessHandler((responseString) => {
    group.loading = false;
    let data = JSON.parse(responseString);
    if (range.allowedDates) {
      data = data.filter(r => range.allowedDates.has(r.fecha)); // recorta las fechas "de relleno" del rango
    }
    Store.setGroupRawData(group.id, data);
  })
  // ...resto igual
  .fetchDashboardData(reqPayload);
```

### Nota importante sobre performance
Para el modo "Día de la Semana" (ej. "todos los viernes de las últimas 8 semanas"), `fromDate`/`toDate` terminan cubriendo las 8 semanas completas aunque solo interesen los viernes — BigQuery igual escanea el rango completo, y el filtro por `allowedDates` ocurre después, en el navegador. Con `MAX_DATE_RANGE_DAYS` (186 días) como tope, esto es aceptable, pero si en la práctica se seleccionan viernes espaciados en varios meses, vale la pena revisar el límite o considerar mandar `allowedDates` al backend para que el filtro de fecha exacta también ocurra en el `WHERE` de BigQuery (ahorra transferencia, no cambia el resultado). No lo incluyo en el alcance de este refactor porque no lo pediste, pero queda anotado como posible optimización futura.

### Criterio de éxito
Crear un grupo con modo "Semanas", usar el calendario para elegir un día de 2 semanas no consecutivas (ej. un día de agosto y un día de octubre), aplicar, y confirmar que `group.rawData` solo contiene fechas de esas 2 semanas — no las semanas intermedias. Repetir eligiendo el mismo día 2 veces para confirmar que no se duplica el chip.

---

## 7. Dropdown de ciudad en los filtros (evitar typos)

### Requisito
El input de ciudad en los filtros (global y por grupo) hoy es texto libre — el usuario puede escribir mal el nombre y la query de BigQuery simplemente no matchea nada (falla en silencio: 0 resultados, sin error visible). Pedido: reemplazarlo por un dropdown con la lista oficial de `city_name_log`.

### Diseño técnico
La lista es fija y de negocio (las mismas 36 ciudades logísticas + `Total Regiones`, el mismo set que usamos para resolver el cruce en la sección 3) — no hace falta un endpoint nuevo que la traiga desde BigQuery, alcanza con una constante en el frontend:

```js
// UI_Filters.html — agregar junto a los demás componentes chicos
const OFFICIAL_CITY_LOG_OPTIONS = [
  'Buin', 'Penaflor', 'Santiago', 'Total Regiones', 'Antofagasta', 'Arica',
  'Calama', 'Castro', 'Chillan', 'Concepcion', 'Copiapo', 'Coyhaique',
  'Curico', 'Iquique', 'La serena', 'Linares', 'Los angeles', 'Maitencillo',
  'Melipilla', 'Osorno', 'Ovalle', 'Pucon', 'Puerto montt', 'Puerto varas',
  'Punta arenas', 'Quillota', 'Rancagua', 'San antonio',
  'San felipe  los andes', 'San fernando', 'Santa cruz', 'Talca', 'Temuco',
  'Valdivia', 'Vallenar', 'Villarrica', 'Vina del mar'
];
```

Reemplazar `<chip-input v-model="...cities" label="Ciudad">` por un nuevo `<city-dropdown>` — mismo patrón de dropdown-con-checkboxes que ya usamos para el filtro de fechas de la tabla (sección 2), para mantener consistencia visual:

```js
const CityDropdownComponent = {
  props: ['modelValue', 'label'],
  emits: ['update:modelValue'],
  data() { return { open: false, options: OFFICIAL_CITY_LOG_OPTIONS }; },
  template: `
    <div class="relative">
      <label class="text-xs font-medium text-peya-navy-70">{{ label }}</label>
      <button @click="open = !open" type="button"
              class="w-full text-left text-sm border border-slate-300 rounded-lg px-2 py-1.5 mt-1">
        {{ modelValue.length ? modelValue.join(', ') : 'Todas' }}
      </button>
      <div v-if="open" class="absolute z-20 bg-white border rounded-lg shadow-lg p-2 max-h-56 overflow-y-auto w-full">
        <label v-for="city in options" :key="city" class="flex items-center gap-2 text-xs py-0.5">
          <input type="checkbox" :value="city" :checked="modelValue.includes(city)" @change="toggle(city)" /> {{ city }}
        </label>
      </div>
    </div>
  `,
  methods: {
    toggle(city) {
      const copy = this.modelValue.slice();
      const i = copy.indexOf(city);
      i === -1 ? copy.push(city) : copy.splice(i, 1);
      this.$emit('update:modelValue', copy);
    }
  }
};
```

El modelo de datos no cambia (sigue siendo `string[]`), así que `computeDateRange`/`aplicarFiltros`/`Controller.fetchDashboardData` no necesitan tocarse — solo cambia cómo se llena el array. Aplica al filtro de ciudad global y al de cada grupo; dejo `zone_name_log` y `franchise_name` como chip-input de texto libre por ahora, porque no tenemos una lista oficial cerrada para esos dos (zona depende de la ciudad elegida, y franquicia es un catálogo que cambia con más frecuencia) — si más adelante quieres el mismo tratamiento para esos, es el mismo componente reutilizado.

### Criterio de éxito
Abrir el dropdown, seleccionar "Temuco", aplicar, y confirmar que la query solo trae partners de `city_name_log = 'Temuco'` — y que no existe ninguna forma de generar un typo que rompa el filtro.

---

## 8. Orden de implementación sugerido

1. **Fix #1 (tabla desaparecida)** — el único bloqueante real, y aísla si el resto de los cambios se ve bien en pantalla.
2. **Fix #6 (filtros temporales)** — bug funcional visible para el usuario, sin dependencias de los otros fixes; conviene resolverlo temprano porque hoy limita qué se puede probar en el resto del refactor (sin esto, solo se puede testear con "fechas específicas").
3. **Fix #7 (dropdown de ciudad)** — chico, sin dependencias, y evita que las pruebas del resto de los fixes se contaminen con typos.
4. **Fix #3 (cruce Perseus/Log + sesiones)** — toca `Service_BigQuery.gs`, es el cambio de mayor riesgo (SQL); ya no tiene conflictos pendientes, así que puede implementarse directo.
5. **Fix #5 (métricas nuevas)** — es el cambio más chico y de menor riesgo, aprovechar el mismo `Store.html` que se toca en el paso anterior.
6. **Fix #2 (filtro de fecha en tabla)** — independiente de todo lo anterior, se puede hacer en paralelo.
7. **Fix #4 (breakdown mall/logistic)** — el de mayor esfuerzo de UI, dejarlo al final.

## 9. Preguntas abiertas antes de empezar
- ¿`zone_name_log` para días sin órdenes queda en "Sin Zona Logística" (sin tabla de cruce a ese nivel), o tienes/puedes armar el equivalente ciudad→zona?
- **Comunas de Santiago**: ¿Opción A (quedan en "Sin Zona Logística", cero esfuerzo extra) u Opción B (matching por polígono geográfico, mismo enfoque que los malls, más esfuerzo pero resuelve esto de raíz)?
