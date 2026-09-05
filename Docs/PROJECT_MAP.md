This file is a merged representation of a subset of the codebase, containing files not matching ignore patterns, combined into a single document by Repomix.

# File Summary

## Purpose
This file contains a packed representation of a subset of the repository's contents that is considered the most important context.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.

## File Format
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  a. A header with the file path (## File: path/to/file)
  b. The full contents of the file in a code block

## Usage Guidelines
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.

## Notes
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Files matching these patterns are excluded: Docs/**, **/assets/**, **/logs/**, **/tests/**, **/*.log, **/.venv/**, **/__pycache__/**, repomix.config.json, README.md
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Files are sorted by Git change count (files with more changes are at the bottom)

# Directory Structure
```
.gitignore
Config.gs
Controller.gs
Index.html
Main.gs
Service_BigQuery.gs
Store.html
Styles.html
UI_Charts.html
UI_Filters.html
UI_Table.html
```

# Files

## File: .gitignore
```
node_modules/
.clasp.json
```

## File: Controller.gs
```
/**
 * Controller.gs
 * Única puerta de entrada para el frontend (google.script.run). Valida los
 * filtros ANTES de tocar BigQuery — así una fecha mal formada o un rango
 * gigante no llegan nunca a convertirse en una query cara o rota.
 */

/**
 * Llamado desde UI_Filters.html al presionar "Aplicar", una vez por grupo.
 *
 * @param {Object} rawFilters
 *   {
 *     fromDate: 'YYYY-MM-DD', toDate: 'YYYY-MM-DD',
 *     cities: string[], zones: string[], franchises: string[],
 *     logisticMarketplace: 'Logistic' | 'Marketplace' | null,
 *     isMall: true | false | null
 *   }
 * @return {Object[]} array de objetos planos (contrato de datos, ver DATA_SHEET.md sección 2)
 */
function fetchDashboardData(rawFilters) {
  const filters = _validateFilters_(rawFilters);

  try {
    const rawData = fetchRawDataset(filters);
    // Comprime el payload masivo en texto plano para eludir el límite de GAS
    return JSON.stringify(rawData);
  } catch (err) {
    console.error('fetchDashboardData error:', err);
    throw new Error('No se pudo obtener el dataset desde BigQuery: ' + err.message);
  }
}

function _validateFilters_(f) {
  if (!f || typeof f !== 'object') {
    throw new Error('Filtros no recibidos o mal formados.');
  }

  const fromDate = _parseDate_(f.fromDate, 'fromDate');
  const toDate = _parseDate_(f.toDate, 'toDate');

  if (fromDate > toDate) {
    throw new Error('fromDate no puede ser posterior a toDate.');
  }

  const rangeDays = Math.round((toDate - fromDate) / (1000 * 60 * 60 * 24)) + 1;
  if (rangeDays > MAX_DATE_RANGE_DAYS) {
    throw new Error(
      'El rango de fechas (' + rangeDays + ' días) supera el máximo permitido (' +
      MAX_DATE_RANGE_DAYS + ' días). Acota el rango o divídelo en más de un grupo.'
    );
  }

  return {
    fromDate: f.fromDate,
    toDate: f.toDate,
    cities: _validateStringArray_(f.cities, 'cities'),
    zones: _validateStringArray_(f.zones, 'zones'),
    franchises: _validateStringArray_(f.franchises, 'franchises'),
    logisticMarketplace: _validateEnum_(f.logisticMarketplace, ['Logistic', 'Marketplace'], 'logisticMarketplace'),
    isMall: _validateBool_(f.isMall, 'isMall')
  };
}

function _parseDate_(value, fieldName) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Campo "' + fieldName + '" inválido: se espera formato YYYY-MM-DD, llegó "' + value + '".');
  }
  const d = new Date(value + 'T00:00:00Z');
  if (isNaN(d.getTime())) {
    throw new Error('Campo "' + fieldName + '" no es una fecha válida: "' + value + '".');
  }
  return d;
}

function _validateStringArray_(value, fieldName) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error('Campo "' + fieldName + '" debe ser un array de strings.');
  }
  return value.filter(function (v) { return typeof v === 'string' && v.length > 0; });
}

function _validateEnum_(value, allowed, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  if (allowed.indexOf(value) === -1) {
    throw new Error('Campo "' + fieldName + '" debe ser uno de [' + allowed.join(', ') + '], llegó "' + value + '".');
  }
  return value;
}

function _validateBool_(value, fieldName) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') {
    throw new Error('Campo "' + fieldName + '" debe ser boolean o null, llegó "' + value + '".');
  }
  return value;
}
```

## File: Main.gs
```
/**
 * Main.gs
 * Punto de entrada de la WebApp. Sin lógica de negocio: solo sirve el shell HTML.
 */

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Dates Analytics Log')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Permite modularizar el frontend: Index.html usa
 * <?!= include('Styles'); ?> para inyectar otros archivos .html.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
```

## File: Service_BigQuery.gs
```
/**
 * Service_BigQuery.gs
 * Aquí vive la Query Maestra y su ejecución. Este archivo es el único punto
 * de contacto con BigQuery — Controller.gs lo llama, nunca al revés.
 *
 * Regla de oro: NUNCA concatenar valores del usuario dentro del SQL.
 * Todo (fechas, ciudades, zonas, franquicias, toggles) viaja como Query
 * Parameter con tipo explícito. Los arrays vacíos ([]) significan "sin filtro"
 * (ver patrón `ARRAY_LENGTH(@param) = 0 OR campo IN UNNEST(@param)`).
 */

/**
 * Punto de entrada: recibe filtros ya validados por Controller.gs
 * y devuelve un array de objetos planos (una fila = un objeto),
 * listo para mandar al frontend vía google.script.run.
 *
 * @param {Object} filters
 *   fromDate, toDate: 'YYYY-MM-DD'
 *   cities, zones, franchises: string[] (vacíos = sin filtro)
 *   logisticMarketplace: 'Logistic' | 'Marketplace' | null
 *   isMall: true | false | null
 */
function fetchRawDataset(filters) {
  const query = buildMasterQuery_(filters);
  const queryParameters = buildQueryParameters_(filters);

  const request = {
    query: query,
    useLegacySql: false,
    parameterMode: 'NAMED',
    queryParameters: queryParameters,
    location: BQ_CONFIG.LOCATION
  };

  let job = BigQuery.Jobs.query(request, BQ_CONFIG.PROJECT_ID);
  const jobId = job.jobReference.jobId;

  return _fetchAndAppendChunks(jobId, BQ_CONFIG.LOCATION);
}

/**
 * Pagina los resultados del job vía getQueryResults hasta agotar el pageToken,
 * y convierte cada fila (formato BQ: { f: [{v: ...}, ...] }) a un objeto plano
 * usando el schema devuelto por el job.
 */
function _fetchAndAppendChunks(jobId, location) {
  let rows = [];
  let schema = null;
  let pageToken = null;

  do {
    const response = BigQuery.Jobs.getQueryResults(BQ_CONFIG.PROJECT_ID, jobId, {
      location: location,
      pageToken: pageToken,
      maxResults: 10000
    });

    if (!response.jobComplete) {
      // Job aún corriendo: reintentar la misma página en el próximo loop.
      Utilities.sleep(500);
      continue;
    }

    // AÑADIDO: Capturar errores de ejecución dentro de BigQuery
    if (response.status && response.status.errorResult) {
      throw new Error("BQ Error: " + response.status.errorResult.message);
    }

    if (!schema) schema = response.schema;
    if (response.rows) rows = rows.concat(response.rows);
    pageToken = response.pageToken || null;

  } while (pageToken);

  return _rowsToObjects(rows, schema);
}

/**
 * Convierte filas crudas de BigQuery { f: [{v}, {v}, ...] } a
 * objetos planos { columna: valor } usando los nombres y tipos del schema.
 */
function _rowsToObjects(rows, schema) {
  if (!schema || !schema.fields) return [];
  const fields = schema.fields;

  return rows.map(function (row) {
    const obj = {};
    row.f.forEach(function (cell, i) {
      const field = fields[i];
      obj[field.name] = _castValue(cell.v, field.type);
    });
    return obj;
  });
}

function _castValue(value, bqType) {
  if (value === null || value === undefined) return null;
  switch (bqType) {
    case 'INTEGER':
    case 'INT64':
      return parseInt(value, 10);
    case 'FLOAT':
    case 'FLOAT64':
    case 'NUMERIC':
      return parseFloat(value);
    case 'BOOLEAN':
    case 'BOOL':
      return value === 'true' || value === true;
    default:
      return value; // STRING, DATE, etc. se devuelven tal cual
  }
}

/**
 * Arma el array de Query Parameters de BigQuery a partir de los filtros
 * ya validados. Arrays vacíos = "sin filtro" (ver WHERE final de la query).
 */
function buildQueryParameters_(filters) {
  const params = [
    { name: 'from_date', parameterType: { type: 'DATE' }, parameterValue: { value: filters.fromDate } },
    { name: 'to_date', parameterType: { type: 'DATE' }, parameterValue: { value: filters.toDate } },
    { name: 'country_id', parameterType: { type: 'INT64' }, parameterValue: { value: String(BQ_CONFIG.COUNTRY_ID) } },
    _arrayParam_('cities', filters.cities),
    _arrayParam_('zones', filters.zones),
    _arrayParam_('franchises', filters.franchises),
    _nullableParam_('logistic_marketplace', 'STRING', filters.logisticMarketplace),
    _nullableParam_('is_mall', 'BOOL', filters.isMall)
  ];
  return params;
}

function _arrayParam_(name, values) {
  const arr = Array.isArray(values) ? values : [];
  return {
    name: name,
    parameterType: { type: 'ARRAY', arrayType: { type: 'STRING' } },
    parameterValue: { arrayValues: arr.map(function (v) { return { value: v.toLowerCase() }; }) }
  };
}

// NUEVA FUNCIÓN: Blinda los parámetros nulos (no inyecta la llave 'value' si no hay datos)
function _nullableParam_(name, type, val) {
  const p = { name: name, parameterType: { type: type }, parameterValue: {} };
  if (val !== null && val !== undefined && val !== '') {
    p.parameterValue.value = String(val);
  }
  return p;
}

/**
 * La Query Maestra, portada 1:1 desde KEY_NOTES.md, con dos cambios:
 * 1) Las fechas hardcodeadas ('2026-01-01'/'2026-01-31') pasan a @from_date/@to_date.
 * 2) Se agrega un WHERE final con los filtros globales del panel (ciudad, zona,
 *    franquicia, logistic/marketplace, mall), todos opcionales.
 *
 * TODO (deuda técnica, no bloqueante para Fase 1): el CTE `malls` con ~90 polígonos
 * hardcodeados debería migrar a una tabla dim_malls en BigQuery. Por ahora se deja
 * embebido tal como venía en la query original para no introducir cambios de
 * alcance en esta fase.
 */
function buildMasterQuery_(filters) {
  let query = `
    WITH malls AS (
      ${_getMallsPolygonsCte_()}
    ),

    base_sessions AS (
      SELECT
        s.area.area_name AS ciudad,
        s.partition_date AS fecha,
        COUNT(DISTINCT s.session_sk) AS total_sessions,
        COUNT(DISTINCT CASE WHEN s.shop_list_loaded THEN s.session_sk END) AS sessions_shop_list,
        COUNT(DISTINCT CASE WHEN s.shop_details_loaded THEN s.session_sk END) AS sessions_shop_details,
        COUNT(DISTINCT CASE WHEN s.checkout_loaded THEN s.session_sk END) AS sessions_checkout,
        COUNT(DISTINCT CASE WHEN s.totals.orders > 0 THEN s.session_sk END) AS sessions_with_orders
      FROM \`${BQ_CONFIG.TABLES.SESSIONS}\` s
      WHERE s.country_id = @country_id
        AND s.partition_date >= @from_date
        AND s.partition_date <= @to_date
      GROUP BY 1, 2
    ),

    base_logistics AS (
      SELECT
        fo.restaurant.id AS partner_id,
        DATE(fo.registered_date) AS fecha,
        ANY_VALUE(l_city.city_name) AS city_name_log,
        ANY_VALUE(l_zone.zone_name) AS zone_name_log,
        SUM(COALESCE(fo.rejected_order, 0)) AS total_rejected_orders
      FROM \`${BQ_CONFIG.TABLES.LOGISTIC_ORDERS}\` l
      LEFT JOIN UNNEST([l.city]) AS l_city
      LEFT JOIN UNNEST([l.zone]) AS l_zone
      INNER JOIN \`${BQ_CONFIG.TABLES.ORDERS}\` fo
        ON fo.order_id = l.peya_order_id
       AND DATE(fo.registered_date) >= @from_date
       AND DATE(fo.registered_date) <= @to_date
      WHERE l.country.country_id = @country_id
        AND l.created_date_local >= @from_date
        AND l.created_date_local <= @to_date
        AND l_zone.zone_name IS NOT NULL
      GROUP BY 1, 2
    ),

    base_partners AS (
      SELECT
        dp.city.name AS ciudad,
        da.area_name AS zone_name,
        DATE(hp.full_date) AS fecha,
        dp.partner_id,
        dp.partner_name,
        dp.franchise.franchise_name AS franchise_name,
        CASE WHEN dp.is_logistic = TRUE THEN 'Logistic' ELSE 'Marketplace' END AS is_logistic_marketplace,
        log.city_name_log,
        log.zone_name_log,
        COALESCE(log.total_rejected_orders, 0) AS rejected_orders,
        IF(m.mall_name IS NOT NULL, TRUE, FALSE) AS is_mall,
        COALESCE(m.mall_name, 'Sin Mall') AS mall_name,
        SUM(COALESCE(hp.schedule_open_time, 0)) AS schedule_open_time,
        SUM(GREATEST(0, COALESCE(hp.schedule_open_time, 0) - COALESCE(hp.closed_times, 0))) AS real_open_time,
        MAX(CASE WHEN COALESCE(hp.schedule_open_time, 0) > 0 THEN 1 ELSE 0 END) AS is_active_partner,
        COUNT(DISTINCT fo.order_id) AS total_orders,
        COUNT(DISTINCT CASE WHEN fo.order_status = 'CONFIRMED' THEN fo.order_id END) AS confirmed_orders
      FROM \`${BQ_CONFIG.TABLES.PARTNER}\` dp
      LEFT JOIN \`${BQ_CONFIG.TABLES.AREA}\` da ON dp.address.area_id = da.area_id
      LEFT JOIN \`${BQ_CONFIG.TABLES.HISTORICAL_PARTNERS}\` hp ON dp.partner_id = hp.restaurant_id
      LEFT JOIN \`${BQ_CONFIG.TABLES.ORDERS}\` fo
        ON dp.partner_id = fo.restaurant.id
       AND DATE(fo.registered_date) >= @from_date
       AND DATE(fo.registered_date) <= @to_date
       AND DATE(fo.registered_date) = DATE(hp.full_date)
      LEFT JOIN base_logistics log ON dp.partner_id = log.partner_id AND DATE(hp.full_date) = log.fecha
      LEFT JOIN malls m 
        ON dp.address.longitude IS NOT NULL 
       AND dp.address.latitude IS NOT NULL 
       AND ST_CONTAINS(m.mall_polygon, ST_GEOGPOINT(dp.address.longitude, dp.address.latitude))
      WHERE (dp.country.country_code = 'CL' OR dp.country_id = @country_id)
        AND hp.is_active = TRUE
        AND DATE(hp.full_date) >= @from_date
        AND DATE(hp.full_date) <= @to_date
      GROUP BY
        dp.city.name, da.area_name, DATE(hp.full_date), dp.partner_id, dp.partner_name,
        dp.franchise.franchise_name, dp.is_logistic, log.city_name_log, log.zone_name_log,
        log.total_rejected_orders, m.mall_name
    ),

    dataset AS (
      SELECT
        p.partner_id AS vendor_code,
        p.partner_name,
        COALESCE(p.franchise_name, 'Sin Franquicia') AS franchise_name,
        p.is_logistic_marketplace,
        p.is_mall,
        p.mall_name,
        p.ciudad,
        p.zone_name,
        COALESCE(p.city_name_log, 'Sin Zona Logística') AS city_name_log,
        COALESCE(p.zone_name_log, 'Sin Zona Logística') AS zone_name_log,
        p.fecha,
        p.is_active_partner,
        p.schedule_open_time AS plan_open_time_minutes,
        p.real_open_time AS real_open_time_minutes,
        p.total_orders,
        p.confirmed_orders,
        p.rejected_orders,
        CASE WHEN p.total_orders > 0 THEN 1 ELSE 0 END AS has_orders,
        COALESCE(s.total_sessions, 0) AS city_total_sessions_raw,
        COALESCE(s.sessions_shop_list, 0) AS city_sessions_shop_list,
        COALESCE(s.sessions_shop_details, 0) AS city_sessions_shop_details,
        COALESCE(s.sessions_checkout, 0) AS city_sessions_checkout,
        COALESCE(s.sessions_with_orders, 0) AS city_sessions_with_orders
      FROM base_partners p
      LEFT JOIN base_sessions s ON p.zone_name = s.ciudad AND p.fecha = s.fecha
    )

    SELECT *
    FROM dataset
    WHERE 1=1
  `;

  // Construcción dinámica de filtros: BigQuery solo evalúa lo que existe.
  if (filters.cities && filters.cities.length > 0) {
    query += ` AND LOWER(city_name_log) IN UNNEST(@cities)\n`;
  }
  if (filters.zones && filters.zones.length > 0) {
    query += ` AND LOWER(zone_name_log) IN UNNEST(@zones)\n`;
  }
  if (filters.franchises && filters.franchises.length > 0) {
    query += ` AND LOWER(franchise_name) IN UNNEST(@franchises)\n`;
  }
  if (filters.logisticMarketplace) {
    query += ` AND is_logistic_marketplace = @logistic_marketplace\n`;
  }
  if (filters.isMall !== null) {
    query += ` AND is_mall = @is_mall\n`;
  }

  query += ` ORDER BY fecha ASC, ciudad ASC, zone_name ASC, vendor_code ASC`;
  
  return query;
}

/**
 * Los ~90 polígonos de malls, portados 1:1 desde KEY_NOTES.md sección 3.
 * Se aísla en su propia función para que buildMasterQuery_() sea legible.
 * TODO (deuda técnica, ver nota más arriba): migrar esto a una tabla
 * dim_malls en BigQuery en vez de mantenerlo hardcodeado en el código.
 */
function _getMallsPolygonsCte_() {
  return `
  SELECT
    mall_name,
    ST_GEOGFROMTEXT(wkt_polygon) AS mall_polygon
  FROM UNNEST([
    STRUCT('Parque Arauco' AS mall_name,'POLYGON((-70.5807102 -33.4021891, -70.5797124 -33.4039402, -70.5757105 -33.4022742, -70.5769336 -33.4005993, -70.5807102 -33.4021891))' AS wkt_polygon),
    STRUCT('Mall Plaza Oeste', 'POLYGON((-70.7182914  -33.5151449, -70.7200456  -33.5181236, -70.7149118  -33.5199751, -70.7131791  -33.5168310, -70.7182914  -33.5151449))'),
    STRUCT('Mall Plaza Vespucio', 'POLYGON((-70.5981874  -33.5158784, -70.6011915  -33.5174930, -70.5996197  -33.5197381, -70.5977583  -33.5188749, -70.5972245  -33.5193691, -70.5958915  -33.5187318, -70.5951458  -33.5176629, -70.5981874  -33.5158784))'),
    STRUCT('Costanera Center', 'POLYGON((-70.6068627  -33.4165602, -70.6082726  -33.4179515, -70.6059337  -33.4191426, -70.6051812  -33.4173749, -70.6068627  -33.4165602))'),
    STRUCT('Mall Plaza El Trébol', 'POLYGON((-73.0703151  -36.7909990, -73.0696338  -36.7923393, -73.0659378  -36.7936281, -73.0626333  -36.7901570, -73.0679494  -36.7882710, -73.0703151  -36.7909990))'),
    STRUCT('Alto Las Condes', 'POLYGON((-70.5478799  -33.3900340, -70.5472147  -33.3915121, -70.5463725  -33.3928960, -70.5442536  -33.3914135, -70.5452996  -33.3890665, -70.5478799  -33.3900340))'),
    STRUCT('Mall Plaza Egaña', 'POLYGON((-70.5684847  -33.4514528, -70.5707511  -33.4517616, -70.5705607  -33.4533930, -70.5701557  -33.4534691, -70.5689836  -33.4533528, -70.5691686  -33.4524710, -70.5683291  -33.4523972, -70.5684847  -33.4514528))'),
    STRUCT('Mall Paseo Chiloé', 'POLYGON((-73.7630653  -42.4793355, -73.7629741  -42.4802158, -73.7620193  -42.4801980, -73.7620354  -42.4797074, -73.7622499  -42.4794858, -73.7625504  -42.4793414, -73.7630653  -42.4793355))'),
    STRUCT('Mall Paseo Costanera', 'POLYGON((-72.9373956  -41.4721594, -72.9378757  -41.4727301, -72.9353946  -41.4737129, -72.9347831  -41.4728527, -72.9359955  -41.4724407, -72.9373956  -41.4721594))'),
    STRUCT('Mall Paseo Costanera Ampliación', 'POLYGON((-72.9346195  -41.4729833, -72.9351479  -41.4737149, -72.9340106  -41.4741731, -72.9335546  -41.4735682, -72.9346195  -41.4729833))'),
    STRUCT('Open Kennedy', 'POLYGON((-70.5767083  -33.4005747, -70.5755013  -33.4021847, -70.5742300  -33.4015711, -70.5751419  -33.3999723, -70.5767083  -33.4005747))'),
    STRUCT('Mall Paseo Del Mar', 'POLYGON((-72.9443452  -41.4715886, -72.9441896  -41.4722056, -72.9425615  -41.4719584, -72.9427144  -41.4713494, -72.9443452  -41.4715886))'),
    STRUCT('Mall Paseo La Paloma', 'POLYGON((-72.9228687  -41.4593863, -72.9239282  -41.4597039, -72.9235151  -41.4604517, -72.9228821  -41.4609844, -72.9220453  -41.4605160, -72.9228687  -41.4593863))'),
    STRUCT('Mall Plaza Los Dominicos', 'POLYGON((-70.5405360  -33.4138410, -70.5413568  -33.4141590, -70.5419415  -33.4145799, -70.5412656  -33.4165321, -70.5393237  -33.4162680, -70.5405360  -33.4138410))'),
    STRUCT('Mall Del Centro Concepción', 'POLYGON((-73.0457622  -36.8246032, -73.0451560  -36.8255415, -73.0442896  -36.8251979, -73.0449066  -36.8242640, -73.0457622  -36.8246032))'),
    STRUCT('Marina Arauco', 'POLYGON((-71.5483546  -33.0082406, -71.5485156  -33.0091943, -71.5474373  -33.0093608, -71.5476412  -33.0103414, -71.5451950  -33.0107688, -71.5449911  -33.0097027, -71.5462732  -33.0095002, -71.5460747  -33.0085645, -71.5483546  -33.0082406))'),
    STRUCT('Mall Plaza Norte', 'POLYGON((-70.6774306  -33.3683575, -70.6776130  -33.3638414, -70.6812716  -33.3634920, -70.6807995  -33.3670493, -70.6774306  -33.3683575))'),
    STRUCT('Mall Plaza Antofagasta', 'POLYGON((-70.4026169  -23.6442097, -70.4034215  -23.6443817, -70.4041082  -23.6448977, -70.4043442  -23.6454579, -70.4035717  -23.6463670, -70.4037112  -23.6490549, -70.4032069  -23.6495610, -70.4028475  -23.6495856, -70.4027188  -23.6472859, -70.4017049  -23.6465488, -70.4021770  -23.6459591, -70.4022092  -23.6446225, -70.4026169  -23.6442097))'),
    STRUCT('Mall Arauco Maipú', 'POLYGON((-70.7514596  -33.4854512, -70.7489061  -33.4826056, -70.7512343  -33.4792857, -70.7551450  -33.4792275, -70.7514596  -33.4854512))'),
    STRUCT('Mall Plaza La Serena', 'POLYGON((-71.2567288  -29.9139741, -71.2561226  -29.9114353, -71.2582147  -29.9114120, -71.2591696  -29.9136486, -71.2576193  -29.9140252, -71.2567288  -29.9139741))'),
    STRUCT('Aires de Mall Plaza La Serena', 'POLYGON((-71.2598723  -29.9138299, -71.2612671  -29.9168057, -71.2576246  -29.9174381, -71.2567663  -29.9142066, -71.2598723  -29.9138299))'),
    STRUCT('Mall Puerta Del Mar', 'POLYGON((-71.2574744  -29.9055112, -71.2569219  -29.8999123, -71.2581396  -29.8998332, -71.2586278  -29.9055344, -71.2574744  -29.9055112))'),
    STRUCT('Mall Patio Rancagua', 'POLYGON((-70.7416266  -34.1678969, -70.7418492  -34.1689555, -70.7405537  -34.1691264, -70.7403526  -34.1680789, -70.7416266  -34.1678969))'),
    STRUCT('Mall Paseo Quilín', 'POLYGON((-70.5792350  -33.4847935, -70.5799806  -33.4879119, -70.5791384  -33.4894822, -70.5763972  -33.4903367, -70.5760753  -33.4884443, -70.5766547  -33.4874332, -70.5770087  -33.4854914, -70.5792350  -33.4847935))'),
    STRUCT('Mall Plaza Sur', 'POLYGON((-70.7120901  -33.6309237, -70.7117951  -33.6328309, -70.7106203  -33.6334383, -70.7100087  -33.6341306, -70.7080239  -33.6346219, -70.7069242  -33.6317411, -70.7104272  -33.6309014, -70.7120901  -33.6309237))'),
    STRUCT('Mall Plaza Los Ángeles', 'POLYGON((-72.3522770  -37.4685208, -72.3522180  -37.4675884, -72.3536852  -37.4675692, -72.3537093  -37.4686017, -72.3522770  -37.4685208))'),
    STRUCT('Portal Temuco', 'POLYGON((-72.6104128  -38.7321339, -72.6114213  -38.7337115, -72.6116627  -38.7336361, -72.6121187  -38.7344061, -72.6100481  -38.7351384, -72.6093346  -38.7340211, -72.6103967  -38.7336068, -72.6096618  -38.7323975, -72.6104128  -38.7321339))'),
    STRUCT('Mercado Urbano Tobalaba', 'POLYGON((-70.6001240  -33.4175553, -70.6004110  -33.4167784, -70.6018326  -33.4170314, -70.6014866  -33.4179090, -70.6001240  -33.4175553))'),
    STRUCT('Mall Plaza Tobalaba', 'POLYGON((-70.5556583  -33.5702334, -70.5557334  -33.5690176, -70.5568439  -33.5679002, -70.5597621  -33.5680343, -70.5588073  -33.5714223, -70.5570209  -33.5711854, -70.5556583  -33.5702334))'),
    STRUCT('Mall Plaza Los Ríos', 'POLYGON((-73.2429287  -39.8158626, -73.2430521  -39.8168350, -73.2428187  -39.8170802, -73.2423225  -39.8171193, -73.2416895  -39.8165528, -73.2415849  -39.8159656, -73.2429287  -39.8158626))'),
    STRUCT('Mall Plaza Calama', 'POLYGON((-68.9213187  -22.4521149, -68.9206481  -22.4501813, -68.9208359  -22.4476924, -68.9220160  -22.4475784, -68.9223057  -22.4491550, -68.9221770  -22.4520554, -68.9213187  -22.4521149))'),
    STRUCT('Mall Florida Center', 'POLYGON((-70.6096888  -33.5098314, -70.6062609  -33.5126537, -70.6038147  -33.5113745, -70.6059176  -33.5094244, -70.6079507  -33.5087803, -70.6096888  -33.5098314))'),
    STRUCT('Apumanque', 'POLYGON((-70.5689567  -33.4093229, -70.5686644  -33.4100796, -70.5692679  -33.4102364, -70.5682701  -33.4108185, -70.5680287  -33.4106013, -70.5668163  -33.4103438, -70.5673233  -33.4088975, -70.5689567  -33.4093229))'),
    STRUCT('Plaza Apoquindo', 'POLYGON((-70.5690318  -33.4093363, -70.5703971  -33.4097192, -70.5700967  -33.4104065, -70.5687261  -33.4100147, -70.5690318  -33.4093363))'),
    STRUCT('Mall Plaza Maule', 'POLYGON((-71.6301513  -35.4308127, -71.6315353  -35.4334746, -71.6295290  -35.4341958, -71.6281611  -35.4313984, -71.6301513  -35.4308127))'),
    STRUCT('Mall Barrio Independencia', 'POLYGON((-70.6546533  -33.4252049, -70.6524378  -33.4250168, -70.6524807  -33.4233334, -70.6539345  -33.4231677, -70.6539720  -33.4237408, -70.6550556  -33.4236423, -70.6546533  -33.4252049))'),
    STRUCT('Mall Portal Talca', 'POLYGON((-71.6550341  -35.4269159, -71.6551039  -35.4279912, -71.6541946  -35.4280895, -71.6541812  -35.4270011, -71.6550341  -35.4269159))'),
    STRUCT('Mall Portal Vivo Coquimbo', 'POLYGON((-71.3380641  -29.9576256, -71.3382438  -29.9584413, -71.3378415  -29.9585412, -71.3374016  -29.9590896, -71.3362670  -29.9579509, -71.3380641  -29.9576256))'),
    STRUCT('Mall Portal La Dehesa', 'POLYGON((-70.5162942  -33.3595088, -70.5133009  -33.3572551, -70.5141163  -33.3561573, -70.5158758  -33.3561215, -70.5169326  -33.3567801, -70.5172116  -33.3585724, -70.5162942  -33.3595088))'),
    STRUCT('Mall Plaza Alameda', 'POLYGON((-70.6831840  -33.4522182, -70.6826556  -33.4535295, -70.6814781  -33.4532185, -70.6818965  -33.4519071, -70.6831840  -33.4522182))'),
    STRUCT('Mall Center Curicó', 'POLYGON((-71.2459624  -34.9886773, -71.2454903  -34.9935379, -71.2439346  -34.9929139, -71.2443423  -34.9889234, -71.2459624  -34.9886773))'),
    STRUCT('Mall Plaza Arica', 'POLYGON((-70.3104025  -18.4697384, -70.3079134  -18.4709087, -70.3071088  -18.4702269, -70.3086483  -18.4684664, -70.3104025  -18.4697384))'),
    STRUCT('Mall Vivo Imperio', 'POLYGON((-70.6489509  -33.4394344, -70.6488812  -33.4399939, -70.6491950  -33.4400409, -70.6491736  -33.4401999, -70.6483018  -33.4401282, -70.6483340  -33.4399604, -70.6484333  -33.4399648, -70.6485137  -33.4393874, -70.6489509  -33.4394344))'),
    STRUCT('Mall Plaza Mirador', 'POLYGON((-73.0661470  -36.8295241, -73.0639207  -36.8316065, -73.0613726  -36.8304730, -73.0626708  -36.8280899, -73.0661470  -36.8295241))'),
    STRUCT('Mall Cenco Ñuñoa', 'POLYGON((-70.5982572  -33.4647494, -70.5983055  -33.4658235, -70.5963394  -33.4658727, -70.5962616  -33.4647852, -70.5982572  -33.4647494))'),
    STRUCT('Mall Paseo La Portada', 'POLYGON((-70.3908849  -23.5653024, -70.3907910  -23.5662932, -70.3884950  -23.5662391, -70.3885782  -23.5651205, -70.3908849  -23.5653024))'),
    STRUCT('Mall Arauco Chillán', 'POLYGON((-72.1014181  -36.6099644, -72.0998517  -36.6102679, -72.0996103  -36.6096199, -72.1011525  -36.6092646, -72.1014181  -36.6099644))'),
    STRUCT('Terminal Alameda', 'POLYGON((-70.6876579  -33.4532588, -70.6872636  -33.4544672, -70.6856972  -33.4540845, -70.6858930  -33.4529522, -70.6876579  -33.4532588))'),
    STRUCT('Terminal Sur', 'POLYGON((-70.6892136  -33.4536034, -70.6890312  -33.4541584, -70.6875238  -33.4538048, -70.6876981  -33.4532588, -70.6892136  -33.4536034))'),
    STRUCT('Mall Arauco Estación', 'POLYGON((-70.6778437  -33.4512670, -70.6798768  -33.4512089, -70.6803650  -33.4516117, -70.6804562  -33.4535228, -70.6780261  -33.4536929, -70.6778437  -33.4512670))'),
    STRUCT('Mall Paseo San Bernardo', 'POLYGON((-70.7063153  -33.5952890, -70.7076591  -33.5950879, -70.7079595  -33.5958073, -70.7072890  -33.5959794, -70.7070985  -33.5954141, -70.7064226  -33.5955504, -70.7063153  -33.5952890))'),
    STRUCT('Mall Valle Curicó', 'POLYGON((-71.2417647  -34.9819902, -71.2417004  -34.9825968, -71.2405336  -34.9825111, -71.2406221  -34.9818804, -71.2417647  -34.9819902))'),
    STRUCT('Subcentro', 'POLYGON((-70.5834487  -33.4143560, -70.5838752  -33.4134269, -70.5858681  -33.4140470, -70.5854523  -33.4150276, -70.5834487  -33.4143560))'),
    STRUCT('Mall Plaza Copiapo', 'POLYGON((-70.3403574  -27.3708384, -70.3396815  -27.3708765, -70.3391719  -27.3702905, -70.3382009  -27.3692663, -70.3396118  -27.3677084, -70.3405130  -27.3677227, -70.3403574  -27.3708384))'),
    STRUCT('Mall Paseo Ross', 'POLYGON((-71.6051745  -33.0490916, -71.6043511  -33.0496087, -71.6039300  -33.0493681, -71.6034713  -33.0491770, -71.6038039  -33.0483497, -71.6045523  -33.0486712, -71.6051745  -33.0490916))'),
    STRUCT('Espacio Urbano Antofagasta', 'POLYGON((-70.3970915  -23.6362339, -70.3970084  -23.6380030, -70.3957450  -23.6379539, -70.3958282  -23.6361651, -70.3970915  -23.6362339))'),
    STRUCT('MidMall Maipú', 'POLYGON((-70.7715976  -33.5374868, -70.7731372  -33.5387522, -70.7704550  -33.5398834, -70.7695055  -33.5385241, -70.7715976  -33.5374868))'),
    STRUCT('Mall Vivo San Fernando', 'POLYGON((-70.9857211  -34.5853344, -70.9862038  -34.5864672, -70.9850264  -34.5868050, -70.9849191  -34.5865622, -70.9852329  -34.5864893, -70.9849727  -34.5858069, -70.9851900  -34.5857363, -70.9850585  -34.5854581, -70.9857211  -34.5853344))'),
    STRUCT('Espacio Urbano La Dehesa', 'POLYGON((-70.5213985  -33.3531507, -70.5186117  -33.3527340, -70.5191427  -33.3514502, -70.5215567  -33.3518243, -70.5213985  -33.3531507))'),
    STRUCT('Mall Shopping Center Quillota', 'POLYGON((-71.2441707  -32.8961329, -71.2447608  -32.8967320, -71.2454581  -32.8969527, -71.2466222  -32.8968716, -71.2467241  -32.8984436, -71.2445408  -32.8985652, -71.2430012  -32.8967860, -71.2441707  -32.8961329))'),
    STRUCT('Mall Paseo Viña Centro', 'POLYGON((-71.5476599  -33.0257473, -71.5479469  -33.0267120, -71.5474615  -33.0272158, -71.5466487  -33.0274114, -71.5463430  -33.0261386, -71.5469465  -33.0258395, -71.5476599  -33.0257473))'),
    STRUCT('Mall Paseo Rotonda', 'POLYGON((-72.9542211  -41.4590326, -72.9541111  -41.4603029, -72.9528987  -41.4604416, -72.9526600  -41.4592376, -72.9542211  -41.4590326))'),
    STRUCT('Mall Arauco San Antonio', 'POLYGON((-71.6149056  -33.5809532, -71.6139588  -33.5817465, -71.6140392  -33.5819029, -71.6132239  -33.5827856, -71.6130012  -33.5826940, -71.6133955  -33.5818694, -71.6138998  -33.5811097, -71.6146857  -33.5807700, -71.6149056  -33.5809532))'),
    STRUCT('Espacio Urbano Puente Alto', 'POLYGON((-70.5743372  -33.6005504, -70.5745250  -33.5985933, -70.5777061  -33.5989240, -70.5772609  -33.6007782, -70.5743372  -33.6005504))'),
    STRUCT('Mall Plaza Iquique', 'POLYGON((-70.1418257  -20.2321052, -70.1429093  -20.2317931, -70.1437515  -20.2340279, -70.1426196  -20.2343601, -70.1418257  -20.2321052))'),
    STRUCT('Mall Arauco Quilicura', 'POLYGON((-70.7308200  -33.3673607, -70.7313859  -33.3682522, -70.7310185  -33.3686621, -70.7299322  -33.3691841, -70.7295352  -33.3692065, -70.7291624  -33.3691303, -70.7291543  -33.3680797, -70.7298946  -33.3674480, -70.7308200  -33.3673607))'),
    STRUCT('Espacio Urbano Maipú', 'POLYGON((-70.7587418  -33.5107237, -70.7587230  -33.5110569, -70.7582992  -33.5110592, -70.7582670  -33.5114013, -70.7574624  -33.5113901, -70.7574677  -33.5107349, -70.7587418  -33.5107237))'),
    STRUCT('Mall Cenco El Llano', 'POLYGON((-70.6509036  -33.4867084, -70.6506005  -33.4855384, -70.6518906  -33.4852767, -70.6522581  -33.4864556, -70.6509036  -33.4867084))'),
    STRUCT('Mall Alto Peñalolen', 'POLYGON((-70.5446479  -33.4785027, -70.5450127  -33.4792566, -70.5438486  -33.4797600, -70.5434141  -33.4790463, -70.5446479  -33.4785027))'),
    STRUCT('Mall Zofri', 'POLYGON((-70.1369923  -20.2049147, -70.1387331  -20.2049172, -70.1387277  -20.2060499, -70.1370648  -20.2067271, -70.1369172  -20.2063369, -70.1372042  -20.2062060, -70.1370057  -20.2057831, -70.1369923  -20.2049147))'),
    STRUCT('Mall Portal Osorno', 'POLYGON((-73.1313112  -40.5747134, -73.1295544  -40.5748051, -73.1296939  -40.5740065, -73.1300694  -40.5738985, -73.1302115  -40.5737111, -73.1302410  -40.5734605, -73.1306192  -40.5734523, -73.1306487  -40.5736703, -73.1309062  -40.5736581, -73.1309223  -40.5738394, -73.1313756  -40.5738150, -73.1313112  -40.5747134))'),
    STRUCT('Mall Plaza América Rancagua', 'POLYGON((-70.7154483  -34.1718448, -70.7168484  -34.1732007, -70.7160893  -34.1736046, -70.7150969  -34.1723286, -70.7154483  -34.1718448))'),
    STRUCT('Mall Vivo Melipilla', 'POLYGON((-71.2138885  -33.6850121, -71.2129927  -33.6850567, -71.2128586  -33.6839475, -71.2137920  -33.6838805, -71.2138885  -33.6850121))'),
    STRUCT('Open Plaza Ovalle', 'POLYGON((-71.1862242  -30.5977067, -71.1834401  -30.6003709, -71.1812031  -30.5985009, -71.1821365  -30.5975589, -71.1837244  -30.5968340, -71.1862242  -30.5977067))'),
    STRUCT('Mall Go! Talca', 'POLYGON((-71.6914988  -35.4436931, -71.6874272  -35.4452270, -71.6868103  -35.4444535, -71.6883606  -35.4436800, -71.6909087  -35.4427753, -71.6914988  -35.4436931))'),
    STRUCT('Mall Open Calera', 'POLYGON((-71.1930692  -32.7924471, -71.1906123  -32.7905621, -71.1909181  -32.7901653, -71.1917281  -32.7901517, -71.1926454  -32.7904223, -71.1944157  -32.7912836, -71.1930692  -32.7924471))'),
    STRUCT('Patio Outlet Maipú', 'POLYGON((-70.7336444  -33.5213481, -70.7354039  -33.5224303, -70.7347172  -33.5235529, -70.7331830  -33.5243757, -70.7318848  -33.5219965, -70.7336444  -33.5213481))'),
    STRUCT('Mall Plaza del Sol', 'POLYGON((-71.4419407  -33.0469782, -71.4409992  -33.0476077, -71.4404199  -33.0470704, -71.4413828  -33.0463869, -71.4419407  -33.0469782))'),
    STRUCT('Mall Paseo Quilpué', 'POLYGON((-71.4426917  -33.0482013, -71.4427239  -33.0486914, -71.4430457  -33.0486891, -71.4430082  -33.0490713, -71.4427534  -33.0490871, -71.4427346  -33.0489522, -71.4421713  -33.0489544, -71.4421552  -33.0482215, -71.4426917  -33.0482013))'),
    STRUCT('Mall Cenco La Reina', 'POLYGON((-70.5416840  -33.4289029, -70.5391735  -33.4286433, -70.5388141  -33.4271793, -70.5429983  -33.4276494, -70.5416840  -33.4289029))'),
    STRUCT('Mall Paseo Los Dominicos', 'POLYGON((-70.5136630  -33.4009285, -70.5152830  -33.4011322, -70.5150658  -33.4026952, -70.5133760  -33.4028228, -70.5137837  -33.4018555, -70.5136630  -33.4009285))'),
    STRUCT('Espacio Urbano Linares', 'POLYGON((-71.6067034  -35.8423429, -71.6072506  -35.8442214, -71.6059363  -35.8445041, -71.6053516  -35.8426342, -71.6067034  -35.8423429))'),
    STRUCT('Mall Arauco Coronel', 'POLYGON((-73.1617945  -37.0144957, -73.1579536  -37.0136219, -73.1581628  -37.0128766, -73.1612366  -37.0134377, -73.1614780  -37.0128295, -73.1622881  -37.0131422, -73.1617945  -37.0144957))'),
    STRUCT('Mall Vivo Los Trapenses', 'POLYGON((-70.5392271  -33.3559647, -70.5402893  -33.3561932, -70.5414265  -33.3570311, -70.5410779  -33.3577121, -70.5391681  -33.3570714, -70.5392271  -33.3559647))'),
    STRUCT('Espacio Urbano Pionero', 'POLYGON((-70.9070224  -53.1305451, -70.9090769  -53.1293478, -70.9113568  -53.1307318, -70.9091896  -53.1320514, -70.9070224  -53.1305451))'),
    STRUCT('Mall Paseo Balmaceda', 'POLYGON((-71.2574878  -29.9251468, -71.2584883  -29.9248516, -71.2597489  -29.9247005, -71.2603846  -29.9264323, -71.2594244  -29.9266740, -71.2589362  -29.9257000, -71.2578070  -29.9259790, -71.2574878  -29.9251468))'),
    STRUCT('Mall Parque Arauco Antofagasta', 'POLYGON((-70.4164356  -23.6959572, -70.4151964  -23.6958098, -70.4153332  -23.6947684, -70.4162961  -23.6948102, -70.4164946  -23.6951958, -70.4164356  -23.6959572))'),
    STRUCT('Mall City Point Ovalle', 'POLYGON((-71.1983156  -30.6013336, -71.1989594  -30.6015968, -71.1987045  -30.6021624, -71.1980152  -30.6019362, -71.1983156  -30.6013336))'),
    STRUCT('Mall Vivo Outlet Chillan', 'POLYGON((-72.0783323  -36.5890167, -72.0746255  -36.5896412, -72.0744967  -36.5885644, -72.0768303  -36.5877030, -72.0783323  -36.5890167))'),
    STRUCT('Espacio Urbano Las Rejas', 'POLYGON((-70.7046470  -33.4568303, -70.7049608  -33.4558009, -70.7056153  -33.4560762, -70.7055429  -33.4570832, -70.7046470  -33.4568303))'),
    STRUCT('Mall Sport', 'POLYGON((-70.5055252  -33.3708215, -70.5058846  -33.3700330, -70.5078855  -33.3701966, -70.5071506  -33.3714375, -70.5055252  -33.3708215))'),
    STRUCT('Mall Paseo Valdivia', 'POLYGON((-73.2438111  -39.8132852, -73.2440767  -39.8143627, -73.2432881  -39.8144740, -73.2430011  -39.8133944, -73.2438111  -39.8132852))'),
    STRUCT('Mall Paseo Curicó', 'POLYGON((-71.2386990  -34.9766762, -71.2385944  -34.9758345, -71.2397531  -34.9757444, -71.2399864  -34.9758103, -71.2398657  -34.9767356, -71.2393829  -34.9766389, -71.2386990  -34.9766762))'),
    STRUCT('Outlet Park', 'POLYGON((-71.4975858  -32.9843590, -71.4981705  -32.9834411, -71.5002733  -32.9834006, -71.5005201  -32.9866044, -71.4996672  -32.9865999, -71.4975858  -32.9843590))'),
    STRUCT('Vivo Outlet La Florida', 'POLYGON((-70.5709040  -33.5335966, -70.5741924  -33.5339677, -70.5734736  -33.5356580, -70.5702335  -33.5355417, -70.5709040  -33.5335966))'),
    STRUCT('Mall Paseo Buin', 'POLYGON((-70.7358921  -33.7368761, -70.7355541  -33.7364344, -70.7355970  -33.7359214, -70.7378608  -33.7357340, -70.7380056  -33.7365593, -70.7358921  -33.7368761))'),
    STRUCT('Patio Outlet Temuco', 'POLYGON((-72.6031736  -38.7500838, -72.6052710  -38.7497826, -72.6055849  -38.7510335, -72.6034284  -38.7513598, -72.6031736  -38.7500838))'),
    STRUCT('Outlet Easton', 'POLYGON((-70.7111675  -33.3355435, -70.7121921  -33.3333160, -70.7146382  -33.3340421, -70.7135493  -33.3362427, -70.7111675  -33.3355435))'),
    STRUCT('Centro Comercial Dragón de Oro', 'POLYGON((-70.6754082  -33.4508776, -70.6759822  -33.4509705, -70.6762236  -33.4502868, -70.6764168  -33.4503137, -70.6761003  -33.4511507, -70.6753653  -33.4510410, -70.6754082  -33.4508776))'),
    STRUCT('Mall Espacio M', 'POLYGON((-70.6537387  -33.4392620, -70.6538513  -33.4387696, -70.6545809  -33.4388390, -70.6544736  -33.4394478, -70.6537387  -33.4392620))'),
    STRUCT('Mall Casa Costanera', 'POLYGON((-70.5977476  -33.3981272, -70.5991557  -33.3978652, -70.5994052  -33.3987094, -70.5978951  -33.3990632, -70.5977476  -33.3981272))'),
    STRUCT('La Fabrica Patio Outlet', 'POLYGON((-70.6252939  -33.4856793, -70.6279331  -33.4849232, -70.6281692  -33.4853841, -70.6280458  -33.4880371, -70.6248111  -33.4878448, -70.6252939  -33.4856793))'),
    STRUCT('Patio Bellavista', 'POLYGON((-70.6355238  -33.4348146, -70.6343839  -33.4345482, -70.6346440  -33.4336059, -70.6357223  -33.4337469, -70.6355238  -33.4348146))'),
    STRUCT('Mall Paseo Puerto Varas', 'POLYGON((-72.9851550  -41.3189588, -72.9861581  -41.3188238, -72.9863834  -41.3195692, -72.9853240  -41.3197162, -72.9851550  -41.3189588))'),
    STRUCT('Espacio Urbano Los Andes', 'POLYGON((-70.6036484  -32.8347184, -70.6055635  -32.8341640, -70.6066847  -32.8343263, -70.7070441  -32.8350881, -70.6042492  -32.8359354, -70.6036484  -32.8347184))'),
    STRUCT('Open Plaza San Felipe', 'POLYGON((-70.7233179  -32.7557793, -70.7237765  -32.7570064, -70.7222047  -32.7574530, -70.7220975  -32.7568237, -70.7220867  -32.7561222, -70.7233179  -32.7557793))'),
    STRUCT('Outlet Paseo Alerce', 'POLYGON((-72.91303843259813  -41.44374739338737, -72.9108712077141  -41.44442295138484, -72.90859937667848  -41.44037791772572, -72.90888637304307  -41.438350719280436, -72.91122794151308  -41.438588366364435, -72.91303843259813  -41.44374739338737))')
  ])`;
}
```

## File: Store.html
```html
<script>
/**
 * Store.html — El "Cerebro" del Frontend (Fase 2 del roadmap).
 *
 * Única fuente de verdad para: estado reactivo de los grupos de comparación
 * y las funciones matemáticas que agregan el dataset crudo de BigQuery.
 *
 * REGLA DE ORO (ver DATA_SHEET.md / KEY_NOTES.md):
 * - Ratios y CVRs: SIEMPRE sum(numerador)/sum(denominador). Nunca promediar
 *   columnas *_pct ni *_rate directamente.
 * - city_total_sessions_raw viene repetido por cada partner de la ciudad:
 *   SIEMPRE desduplicar por ciudad+fecha antes de sumar sesiones.
 *
 * Ninguna vista (UI_Charts, UI_Table) debe calcular métricas por su cuenta:
 * todas pasan por las funciones de este archivo.
 */
const Store = (function () {
  const { reactive } = Vue;

  // ---------------------------------------------------------------------
  // ESTADO REACTIVO
  // ---------------------------------------------------------------------
  // Cada grupo: { id, filtrosLocales, rangoTemporal, rawData, aggregatedData }
  // rawData: array de objetos tal como llega de Controller.fetchDashboardData
  // aggregatedData: { timeSeries, partnerTotals, dedupedTotalSessions } — ver aggregateGroup()
    const state = reactive({
    groups: [],
    // Se incrementa una sola vez por carga completa de grupo (ver
    // setGroupRawData). UI_Charts.html y UI_Table.html vigilan esto en vez
    // de hacer watch({deep:true}) sobre storeState.groups — evita que Vue
    // tenga que recorrer recursivamente miles de filas de rawData en cada
    // ciclo reactivo.
    version: 0
  });

  // ---------------------------------------------------------------------
  // MOTOR MATEMÁTICO — funciones puras, sin dependencia del estado
  // ---------------------------------------------------------------------

  /**
   * Desduplica sesiones de ciudad por la llave ciudad+fecha.
   * `rawData` trae `city_total_sessions_raw` repetido en cada fila de partner
   * de esa ciudad ese día — sumarlo directo multiplicaría las sesiones reales.
   *
   * @return Map con key "ciudad|fecha" -> { ciudad, fecha, total_sessions,
   *   sessions_shop_list, sessions_shop_details, sessions_checkout, sessions_with_orders }
   */
  function dedupeCitySessions(rows) {
    const map = new Map();
    rows.forEach(function (row) {
      const key = row.ciudad + '|' + row.fecha;
      if (!map.has(key)) {
        map.set(key, {
          ciudad: row.ciudad,
          fecha: row.fecha,
          total_sessions: row.city_total_sessions_raw || 0,
          sessions_shop_list: row.city_sessions_shop_list || 0,
          sessions_shop_details: row.city_sessions_shop_details || 0,
          sessions_checkout: row.city_sessions_checkout || 0,
          sessions_with_orders: row.city_sessions_with_orders || 0
        });
      }
      // Si la misma ciudad+fecha ya está registrada, se ignora (es la
      // fila duplicada de otro partner) — por diseño no se suma de nuevo.
    });
    return map;
  }

  /**
   * Ratio genérico: SUM(numerador) / SUM(denominador) sobre un array de filas.
   * Nunca promedia columnas de porcentaje ya calculadas.
   * @return number | null (null si el denominador total es 0, para no dividir por cero)
   */
  function calcRatio(rows, numKey, denKey) {
    let num = 0, den = 0;
    rows.forEach(function (r) {
      num += (r[numKey] || 0);
      den += (r[denKey] || 0);
    });
    return den > 0 ? num / den : null;
  }

  /** Share de un partner sobre el total de órdenes del grupo renderizado. */
  function calcShareOverGroup(partnerOrders, groupTotalOrders) {
    return groupTotalOrders > 0 ? partnerOrders / groupTotalOrders : null;
  }

  /** Penetración: órdenes del partner / sesiones de ciudad YA desduplicadas. */
  function calcPenetracion(partnerOrders, dedupedCitySessionsTotal) {
    return dedupedCitySessionsTotal > 0 ? partnerOrders / dedupedCitySessionsTotal : null;
  }

  function sumBy_(rows, key) {
    return rows.reduce(function (acc, r) { return acc + (r[key] || 0); }, 0);
  }

  // ---------------------------------------------------------------------
  // AGREGACIÓN DE UN GRUPO COMPLETO
  // ---------------------------------------------------------------------

  /**
   * A partir del rawData de un grupo, produce:
   * - timeSeries: una fila agregada por fecha (para UI_Charts)
   * - partnerTotals: una fila agregada por vendor_code para todo el período (para UI_Table)
   * - dedupedTotalSessions: sesiones de ciudad ya desduplicadas, sumadas para todo el período
   */
  function aggregateGroup(rawData) {
    if (!rawData || rawData.length === 0) {
      return { timeSeries: [], partnerTotals: [], dedupedTotalSessions: 0 };
    }

    const cityDedup = dedupeCitySessions(rawData);
    const dedupedTotalSessions = sumBy_(Array.from(cityDedup.values()), 'total_sessions');

    // ---- Time series (por fecha) ----
    const byDate = new Map();
    rawData.forEach(function (row) {
      if (!byDate.has(row.fecha)) byDate.set(row.fecha, []);
      byDate.get(row.fecha).push(row);
    });

    const timeSeries = Array.from(byDate.keys()).sort().map(function (fecha) {
      const rowsOfDate = byDate.get(fecha);

      // Sesiones del día: sumar solo las entradas deduplicadas cuya fecha sea esta.
      const sessionsOfDate = Array.from(cityDedup.values())
        .filter(function (c) { return c.fecha === fecha; });
      const totalSessionsDate = sumBy_(sessionsOfDate, 'total_sessions');
      const sessionsWithOrdersDate = sumBy_(sessionsOfDate, 'sessions_with_orders');
      const sessionsShopListDate = sumBy_(sessionsOfDate, 'sessions_shop_list');
      const sessionsShopDetailsDate = sumBy_(sessionsOfDate, 'sessions_shop_details');
      const sessionsCheckoutDate = sumBy_(sessionsOfDate, 'sessions_checkout');

      return {
        fecha: fecha,
        total_orders: sumBy_(rowsOfDate, 'total_orders'),
        confirmed_orders: sumBy_(rowsOfDate, 'confirmed_orders'),
        rejected_orders: sumBy_(rowsOfDate, 'rejected_orders'),
        fail_rate: calcRatio(rowsOfDate, 'rejected_orders', 'total_orders'),
        open_time_pct: calcRatio(rowsOfDate, 'real_open_time_minutes', 'plan_open_time_minutes'),
        city_total_sessions: totalSessionsDate,
        city_cvr_neto: totalSessionsDate > 0 ? sessionsWithOrdersDate / totalSessionsDate : null,
        city_cvr_2: sessionsShopListDate > 0 ? sessionsShopDetailsDate / sessionsShopListDate : null,
        city_cvr_3: sessionsCheckoutDate > 0 ? sessionsWithOrdersDate / sessionsCheckoutDate : null
      };
    });

    // ---- Totales por partner (para el ranking) ----
    const byPartner = new Map();
    rawData.forEach(function (row) {
      if (!byPartner.has(row.vendor_code)) byPartner.set(row.vendor_code, []);
      byPartner.get(row.vendor_code).push(row);
    });

    const groupTotalOrders = sumBy_(rawData, 'total_orders');

    const partnerTotals = Array.from(byPartner.entries()).map(function (entry) {
      const vendorCode = entry[0];
      const rows = entry[1];
      const first = rows[0]; // atributos estáticos del partner (nombre, mall, etc.)
      const totalOrders = sumBy_(rows, 'total_orders');
      const rejectedOrders = sumBy_(rows, 'rejected_orders');

      return {
        vendor_code: vendorCode,
        partner_name: first.partner_name,
        franchise_name: first.franchise_name,
        is_mall: first.is_mall,
        is_logistic_marketplace: first.is_logistic_marketplace,
        total_orders: totalOrders,
        rejected_orders: rejectedOrders,
        fail_rate: calcRatio(rows, 'rejected_orders', 'total_orders'),
        open_time_pct: calcRatio(rows, 'real_open_time_minutes', 'plan_open_time_minutes'),
        share_over_group: calcShareOverGroup(totalOrders, groupTotalOrders),
        penetracion: calcPenetracion(totalOrders, dedupedTotalSessions)
      };
    });

    return { timeSeries: timeSeries, partnerTotals: partnerTotals, dedupedTotalSessions: dedupedTotalSessions };
  }

  // ---------------------------------------------------------------------
  // GESTIÓN DE GRUPOS (2 a 4)
  // ---------------------------------------------------------------------

  function addGroup(label, filtrosLocales, rangoTemporal) {
    if (state.groups.length >= 4) {
      throw new Error('Máximo 4 grupos de comparación.');
    }
    const group = {
      id: 'g_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      label: label || ('Grupo ' + (state.groups.length + 1)),
      filtrosLocales: filtrosLocales || {},
      rangoTemporal: rangoTemporal || {},
      rawData: [],
      aggregatedData: { timeSeries: [], partnerTotals: [], dedupedTotalSessions: 0 },
      loading: false,
      error: null
    };
    state.groups.push(group);
    return group.id;
  }

  function removeGroup(groupId) {
    const idx = state.groups.findIndex(function (g) { return g.id === groupId; });
    if (idx !== -1) state.groups.splice(idx, 1);
  }

  function getGroup(groupId) {
    return state.groups.find(function (g) { return g.id === groupId; }) || null;
  }

  /**
   * Se llama una sola vez, justo después de que google.script.run trae el
   * rawData del backend para ese grupo. Dispara la agregación completa.
   * A partir de acá, cualquier cambio de eje/tipo de gráfico/granularidad
   * en la UI relee aggregatedData sin volver a llamar al servidor.
   */
    function setGroupRawData(groupId, rawData) {
    const group = getGroup(groupId);
    if (!group) throw new Error('Grupo no encontrado: ' + groupId);
    // markRaw: le dice a Vue que NO convierta este array en reactivo fila
    // por fila. Sigue siendo un array JS normal (se lee/filtra igual en
    // aggregateGroup, en UI_Table.html, etc.), pero Vue deja de tener que
    // proxyar recursivamente cada una de sus filas al asignarlo dentro de
    // un objeto ya reactivo (group). Nadie necesita reactividad campo por
    // campo sobre el dataset crudo — solo aggregatedData, que sí es chico.
    group.rawData = Vue.markRaw(rawData);
    group.aggregatedData = aggregateGroup(rawData);
    state.version++;
  }

  // ---------------------------------------------------------------------
  // SUITE DE VALIDACIÓN MANUAL (Fase 2 del roadmap)
  // Corre con datos mock que replican el caso "3 partners, 1 ciudad, 2 fechas"
  // documentado en BITACORA_REFACTOR.md. Ejecutar en consola: Store.runValidationTests()
  // ---------------------------------------------------------------------
  function runValidationTests() {
    const mockRows = [
      // Día 1 — Santiago, sesiones de ciudad = 1000 (repetidas por cada partner, a propósito)
      { vendor_code: 'A', partner_name: 'Partner A', franchise_name: null, is_mall: false, is_logistic_marketplace: 'Logistic', ciudad: 'Santiago', fecha: '2026-01-01', total_orders: 10, confirmed_orders: 9, rejected_orders: 2, real_open_time_minutes: 500, plan_open_time_minutes: 600, city_total_sessions_raw: 1000, city_sessions_shop_list: 800, city_sessions_shop_details: 600, city_sessions_checkout: 400, city_sessions_with_orders: 300 },
      { vendor_code: 'B', partner_name: 'Partner B', franchise_name: null, is_mall: true, is_logistic_marketplace: 'Marketplace', ciudad: 'Santiago', fecha: '2026-01-01', total_orders: 5, confirmed_orders: 5, rejected_orders: 0, real_open_time_minutes: 550, plan_open_time_minutes: 600, city_total_sessions_raw: 1000, city_sessions_shop_list: 800, city_sessions_shop_details: 600, city_sessions_checkout: 400, city_sessions_with_orders: 300 },
      { vendor_code: 'C', partner_name: 'Partner C', franchise_name: 'Franquicia X', is_mall: false, is_logistic_marketplace: 'Logistic', ciudad: 'Santiago', fecha: '2026-01-01', total_orders: 20, confirmed_orders: 15, rejected_orders: 5, real_open_time_minutes: 400, plan_open_time_minutes: 600, city_total_sessions_raw: 1000, city_sessions_shop_list: 800, city_sessions_shop_details: 600, city_sessions_checkout: 400, city_sessions_with_orders: 300 },
      // Día 2 — Santiago, sesiones de ciudad = 1200
      { vendor_code: 'A', partner_name: 'Partner A', franchise_name: null, is_mall: false, is_logistic_marketplace: 'Logistic', ciudad: 'Santiago', fecha: '2026-01-02', total_orders: 8, confirmed_orders: 7, rejected_orders: 1, real_open_time_minutes: 590, plan_open_time_minutes: 600, city_total_sessions_raw: 1200, city_sessions_shop_list: 900, city_sessions_shop_details: 700, city_sessions_checkout: 500, city_sessions_with_orders: 350 },
      { vendor_code: 'B', partner_name: 'Partner B', franchise_name: null, is_mall: true, is_logistic_marketplace: 'Marketplace', ciudad: 'Santiago', fecha: '2026-01-02', total_orders: 6, confirmed_orders: 3, rejected_orders: 3, real_open_time_minutes: 300, plan_open_time_minutes: 600, city_total_sessions_raw: 1200, city_sessions_shop_list: 900, city_sessions_shop_details: 700, city_sessions_checkout: 500, city_sessions_with_orders: 350 },
      { vendor_code: 'C', partner_name: 'Partner C', franchise_name: 'Franquicia X', is_mall: false, is_logistic_marketplace: 'Logistic', ciudad: 'Santiago', fecha: '2026-01-02', total_orders: 15, confirmed_orders: 10, rejected_orders: 5, real_open_time_minutes: 580, plan_open_time_minutes: 600, city_total_sessions_raw: 1200, city_sessions_shop_list: 900, city_sessions_shop_details: 700, city_sessions_checkout: 500, city_sessions_with_orders: 350 }
    ];

    const expected = {
      dedupedTotalSessions: 1000 + 1200, // NO 6600 (que sería el bug de sumar sin desduplicar)
      groupTotalOrders: 10 + 5 + 20 + 8 + 6 + 15, // 64
      groupFailRate: (2 + 0 + 5 + 1 + 3 + 5) / (10 + 5 + 20 + 8 + 6 + 15), // 16/64 = 0.25
      partnerA_totalOrders: 10 + 8, // 18
      partnerA_share: (10 + 8) / 64,
      partnerA_penetracion: (10 + 8) / (1000 + 1200)
    };

    const agg = aggregateGroup(mockRows);
    const partnerA = agg.partnerTotals.find(function (p) { return p.vendor_code === 'A'; });
    const groupFailRate = calcRatio(mockRows, 'rejected_orders', 'total_orders');

    const results = [
      _check_('dedupedTotalSessions', agg.dedupedTotalSessions, expected.dedupedTotalSessions),
      _check_('groupFailRate', groupFailRate, expected.groupFailRate),
      _check_('partnerA.total_orders', partnerA.total_orders, expected.partnerA_totalOrders),
      _check_('partnerA.share_over_group', partnerA.share_over_group, expected.partnerA_share),
      _check_('partnerA.penetracion', partnerA.penetracion, expected.partnerA_penetracion)
    ];

    const allPass = results.every(function (r) { return r.pass; });
    console.log(allPass ? '✅ Store.runValidationTests(): TODOS los casos pasaron' : '❌ Store.runValidationTests(): hay casos fallando');
    console.table(results);
    return allPass;
  }

  function _check_(label, actual, expected, tolerance) {
    tolerance = tolerance || 1e-9;
    const pass = Math.abs(actual - expected) < tolerance;
    return { caso: label, esperado: expected, obtenido: actual, resultado: pass ? 'PASS' : 'FAIL' };
  }

  // ---------------------------------------------------------------------
  return {
    state: state,
    // motor matemático (expuesto para tests / uso puntual desde la UI si hace falta)
    dedupeCitySessions: dedupeCitySessions,
    calcRatio: calcRatio,
    calcShareOverGroup: calcShareOverGroup,
    calcPenetracion: calcPenetracion,
    aggregateGroup: aggregateGroup,
    // gestión de grupos
    addGroup: addGroup,
    removeGroup: removeGroup,
    getGroup: getGroup,
    setGroupRawData: setGroupRawData,
    // validación
    runValidationTests: runValidationTests
  };
})();
</script>
```

## File: Config.gs
```
/**
 * Config.gs
 * Configuración central del proyecto. Nada de valores de negocio hardcodeados:
 * fechas, ciudades, zonas, etc. siempre llegan como parámetros desde el frontend
 * y viajan como Query Parameters de BigQuery (nunca concatenados en el SQL).
 */

const BQ_CONFIG = {
  PROJECT_ID: 'peya-chile',
  LOCATION: 'US', // TODO: confirmar región real de los datasets si las queries fallan por location mismatch

  // Tablas reales que usa la Query Maestra (ver Service_BigQuery.gs)
  TABLES: {
    SESSIONS: 'peya-bi-tools-pro.il_sessions.fact_perseus_sessions',
    LOGISTIC_ORDERS: 'peya-bi-tools-pro.il_logistics.fact_logistic_orders',
    ORDERS: 'peya-bi-tools-pro.il_core.fact_orders',
    PARTNER: 'peya-bi-tools-pro.il_core.dim_partner',
    AREA: 'peya-bi-tools-pro.il_core.dim_area',
    HISTORICAL_PARTNERS: 'peya-bi-tools-pro.il_core.dim_historical_partners'
  },

  COUNTRY_ID: 2 // Chile
};

// Límite de seguridad: rango máximo de días por grupo para no escanear
// datasets completos sin querer. Ajustar según performance real observada.
const MAX_DATE_RANGE_DAYS = 186; // ~6 meses
```

## File: Styles.html
```html
<style>
  :root {
    /* Brand Colors (Rojos PeYa) */
    --peya-red-50: #EA044E;
    --peya-red-40: #EC1D60;
    --peya-red-70: #B40443;
    --peya-red-20: #F481A6;

    /* Navy Colors (Neutros y Textos) */
    --peya-navy-90: #100423;
    --peya-navy-70: #4C4359;
    --peya-navy-60: #70697A;

    /* Semantic Colors (Feedback y Destaques) */
    --peya-informative: #04ADDF;
    --peya-deals-comms: #F8EA46;
    --peya-accent: #72E6FF;
    --peya-positive: #2DE1A0;

    /* Básicos */
    --peya-white: #FFFFFF;
    --peya-background: #F8F9FA;
  }

  html, body {
    height: 100%;
    background-color: var(--peya-background);
    color: var(--peya-navy-90);
  }
</style>
```

## File: UI_Charts.html
```html
<script>
const UI_Charts = {
  template: `
    <div v-if="hasData" class="w-full max-w-7xl mx-auto bg-peya-white shadow-sm rounded-xl border border-slate-200 p-6 mb-6">
      
      <!-- Controles del Gráfico -->
      <div class="flex flex-col mb-6 border-b border-slate-100 pb-4 gap-4">
        <div class="flex flex-wrap justify-between items-center w-full">
          <h2 class="text-xl font-bold text-peya-navy-90">Tendencias Temporales</h2>
          <div class="flex items-center gap-4">
            <label class="flex items-center gap-2 cursor-pointer bg-slate-100 px-3 py-1.5 rounded-lg hover:bg-slate-200 transition">
              <input type="checkbox" v-model="config.showLabels" @change="renderCharts" class="rounded text-peya-red-50 focus:ring-peya-red-50" />
              <span class="text-sm font-medium text-peya-navy-90">Etiquetas</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer bg-slate-100 px-3 py-1.5 rounded-lg hover:bg-slate-200 transition">
              <input type="checkbox" v-model="config.merged" @change="renderCharts" class="rounded text-peya-red-50 focus:ring-peya-red-50" />
              <span class="text-sm font-medium text-peya-navy-90">Fusionar Grupos</span>
            </label>
            <button @click="addMetric" class="text-xs bg-transparent border border-peya-navy-60 text-peya-navy-90 hover:bg-slate-100 px-3 py-1.5 rounded-full font-medium transition flex items-center gap-1">
              <svg class="w-3 h-3 fill-current" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M7.37019 2.73075C7.37019 2.32717 7.69736 2 8.10095 2C8.50453 2 8.8317 2.32717 8.8317 2.73075L8.8317 7.1683L13.2692 7.1683C13.6728 7.1683 14 7.49547 14 7.89906C14 8.30264 13.6728 8.62981 13.2692 8.62981H8.8317L8.8317 13.2692C8.8317 13.6728 8.50453 14 8.10094 14C7.69736 14 7.37019 13.6728 7.37019 13.2692L7.37019 8.62981H2.73075C2.32717 8.62981 2 8.30264 2 7.89906C2 7.49547 2.32717 7.1683 2.73075 7.1683H7.37019L7.37019 2.73075Z"/></svg>
              Añadir Métrica
            </button>
          </div>
        </div>

        <!-- Lista de métricas configuradas -->
        <div class="flex flex-wrap gap-3">
          <div v-for="(cfg, idx) in config.metrics" :key="idx" class="flex items-center gap-2 bg-slate-50 border border-slate-200 p-2 rounded-lg relative pr-8">
            <button v-if="config.metrics.length > 1" @click="removeMetric(idx)" class="absolute top-2.5 right-2 text-peya-navy-60 hover:text-peya-red-50">
              <svg class="w-3 h-3 fill-current" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M2.74465 2.73766C3.06852 2.42078 3.59193 2.42078 3.91579 2.73766L8.11718 6.84831L12.0842 2.96695C12.4081 2.65007 12.9315 2.65007 13.2554 2.96695C13.5815 3.2861 13.5815 3.80532 13.2553 4.12448L9.29429 8L13.2553 11.8755C13.5815 12.1947 13.5815 12.7139 13.2553 13.0331C12.9315 13.3499 12.4081 13.3499 12.0842 13.0331L8.11717 9.15169L3.9158 13.2623C3.59193 13.5792 3.06852 13.5792 2.74465 13.2623C2.41845 12.9432 2.41845 12.424 2.74465 12.1048L6.94006 8L2.74465 3.89518C2.41845 3.57603 2.41845 3.05681 2.74465 2.73766Z"/></svg>
            </button>
            <select v-model="cfg.id" @change="renderCharts" class="text-xs border-slate-300 rounded shadow-sm focus:ring-peya-red-50 focus:border-peya-red-50">
              <option value="total_orders">Órdenes Totales</option>
              <option value="confirmed_orders">Órdenes Confirmadas</option>
              <option value="rejected_orders">Órdenes Rechazadas</option>
              <option value="fail_rate">Fail Rate %</option>
              <option value="city_total_sessions">Sesiones de Ciudad</option>
              <option value="city_cvr_neto">City CVR Neto</option>
              <option value="city_cvr_2">City CVR 2</option>
              <option value="city_cvr_3">City CVR 3</option>
              <option value="open_time_pct">Cumplimiento Open Time %</option>
            </select>
            <select v-model="cfg.type" @change="renderCharts" class="text-xs border-slate-300 rounded shadow-sm focus:ring-peya-red-50 focus:border-peya-red-50">
              <option value="line">Línea</option>
              <option value="area">Área</option>
              <option value="bar">Barra</option>
            </select>
            <select v-model="cfg.axis" @change="renderCharts" class="text-xs border-slate-300 rounded shadow-sm focus:ring-peya-red-50 focus:border-peya-red-50">
              <option value="left">Eje Izq (I)</option>
              <option value="right">Eje Der (D)</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Lienzos de Gráficos -->
      <div v-if="config.merged" id="chart-merged" class="w-full h-96"></div>
      
      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div v-for="group in groupsWithData" :key="group.id" class="border border-slate-100 rounded-lg p-2 bg-slate-50">
          <h3 class="text-center text-sm font-bold text-peya-navy-70 mb-2">{{ group.label }}</h3>
          <div :id="'chart-' + group.id" class="w-full h-72"></div>
        </div>
      </div>

    </div>
  `,
  setup() {
    const { computed, reactive, watch, nextTick, onUnmounted } = Vue;
    const storeState = Store.state;
    let chartInstances = [];

    // Ahora soporta múltiples métricas por defecto
    const config = reactive({
      metrics: [{ id: 'total_orders', type: 'bar', axis: 'left' }],
      merged: false,
      showLabels: false
    });

    const addMetric = () => {
      config.metrics.push({ id: 'fail_rate', type: 'line', axis: 'right' });
      renderCharts();
    };

    const removeMetric = (index) => {
      config.metrics.splice(index, 1);
      renderCharts();
    };

    const groupsWithData = computed(() => {
      return storeState.groups.filter(g => g.aggregatedData && g.aggregatedData.timeSeries.length > 0);
    });

    const hasData = computed(() => groupsWithData.value.length > 0);

    const formatValue = (val, metric) => {
      if (['fail_rate', 'open_time_pct', 'city_cvr_neto', 'city_cvr_2', 'city_cvr_3'].includes(metric)) {
        return (val * 100).toFixed(2) + '%';
      }
      return val.toLocaleString('es-CL');
    };

    // Mapeo corto para ahorrar espacio en las leyendas de ECharts
    const legendLabels = {
      total_orders: 'Total Orders',
      confirmed_orders: 'Confirmed',
      rejected_orders: 'Rejected',
      fail_rate: '% FR',
      city_total_sessions: 'Sessions',
      city_cvr_neto: '% CVR Neto',
      city_cvr_2: '% CVR2',
      city_cvr_3: '% CVR3',
      open_time_pct: '% OT'
    };

    const disposeCharts = () => {
      chartInstances.forEach(instance => instance.dispose());
      chartInstances = [];
    };

    const renderCharts = async () => {
      if (!hasData.value || config.metrics.length === 0) return;
      
      await nextTick();
      disposeCharts();

      // Colores corporativos base, expandidos con variaciones tonales coherentes[cite: 10]
      const peyaColors = [
        '#EA044E', '#4C4359', '#04ADDF', '#2DE1A0', 
        '#EC1D60', '#70697A', '#72E6FF', '#F8EA46',
        '#B40443', '#100423'
      ];

      // Configuración nativa ECharts para Eje Y Dual
      const dualYAxis = [
        { type: 'value', position: 'left' },
        { type: 'value', position: 'right', splitLine: { show: false } } // Ocultar líneas del eje secundario para evitar ruido
      ];

      if (config.merged) {
        // --- MODO FUSIONADO ---
        const dom = document.getElementById('chart-merged');
        if (!dom) return;
        
        const chart = echarts.init(dom);
        chartInstances.push(chart);

        const allDates = new Set();
        groupsWithData.value.forEach(g => {
          g.aggregatedData.timeSeries.forEach(d => allDates.add(d.fecha));
        });
        const xAxisData = Array.from(allDates).sort();

        // En merged mode, las series son: (Grupos * Métricas)
        let series = [];
        let colorIdx = 0;

        groupsWithData.value.forEach(g => {
          const dataMap = new Map(g.aggregatedData.timeSeries.map(d => [d.fecha, d]));
          
          config.metrics.forEach(cfg => {
            series.push({
              name: `${g.label} - ${legendLabels[cfg.id]}`,
              type: cfg.type === 'area' ? 'line' : cfg.type,
              smooth: true,
              yAxisIndex: cfg.axis === 'right' ? 1 : 0,
              data: xAxisData.map(fecha => {
                const row = dataMap.get(fecha);
                return row ? row[cfg.id] : 0;
              }),
              areaStyle: cfg.type === 'area' ? { opacity: 0.1 } : null,
              label: {
                show: config.showLabels,
                position: 'top',
                formatter: (p) => formatValue(p.value, cfg.id)
              },
              itemStyle: { color: peyaColors[colorIdx % peyaColors.length] }
            });
            colorIdx++;
          });
        });

        chart.setOption({
          tooltip: { trigger: 'axis' },
          legend: { top: 'bottom', type: 'scroll' },
          grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
          xAxis: { type: 'category', data: xAxisData },
          yAxis: dualYAxis,
          series: series
        });

      } else {
        // --- MODO SEPARADO (SINCRONIZADO) ---
        groupsWithData.value.forEach((g, index) => {
          const dom = document.getElementById('chart-' + g.id);
          if (!dom) return;

          const chart = echarts.init(dom);
          chartInstances.push(chart);

          const xAxisData = g.aggregatedData.timeSeries.map(d => d.fecha);
          
          const series = config.metrics.map((cfg, mIdx) => {
            const seriesData = g.aggregatedData.timeSeries.map(d => d[cfg.id]);
            return {
              name: legendLabels[cfg.id],
              type: cfg.type === 'area' ? 'line' : cfg.type,
              smooth: true,
              yAxisIndex: cfg.axis === 'right' ? 1 : 0,
              data: seriesData,
              areaStyle: cfg.type === 'area' ? { opacity: 0.1 } : null,
              label: {
                show: config.showLabels,
                position: 'top',
                formatter: (p) => formatValue(p.value, cfg.id)
              },
              itemStyle: { color: peyaColors[mIdx % peyaColors.length] }
            };
          });

          chart.setOption({
            tooltip: { trigger: 'axis' },
            legend: { top: 'top', type: 'scroll' },
            grid: { left: '5%', right: '5%', bottom: '10%', top: '15%', containLabel: true },
            xAxis: { type: 'category', data: xAxisData },
            yAxis: dualYAxis,
            series: series
          });
        });

        echarts.connect(chartInstances);
      }
    };
    
    // Escuchar cambios de versión (Store.state.version se incrementa una vez
    // por carga de grupo, no por cada campo interno de rawData) — evita un
    // deep-watch carísimo sobre datasets de miles de filas.
    // flush: 'post' es obligatorio acá: sin esto, el callback corre ANTES de
    // que Vue cree los <div id="chart-..."> que aparecen recién cuando
    // v-if="hasData" pasa a true en el mismo ciclo — document.getElementById
    // devuelve null y el gráfico queda en blanco hasta el próximo trigger manual.
    watch(() => storeState.version, () => {
      renderCharts();
    }, { flush: 'post' });

    // Limpiar memoria al desmontar
    onUnmounted(() => disposeCharts());

    return {
      config,
      hasData,
      groupsWithData,
      addMetric,
      removeMetric,
      renderCharts
    };
  }
};
</script>
```

## File: UI_Filters.html
```html
<script>
/**
 * Componente Vue: UI_Filters
 * Maneja el panel de configuración global, la instanciación de grupos 
 * y la comunicación con el backend (google.script.run).
 */
const UI_Filters = {
  template: `
    <div class="w-full max-w-7xl mx-auto bg-peya-white shadow-sm rounded-xl border border-slate-200 p-6 mb-6">
      
      <!-- HEADER & APLICAR -->
      <div class="flex flex-wrap justify-between items-center mb-6 border-b border-slate-100 pb-4 gap-4">
        <h2 class="text-xl font-bold text-peya-navy-90 flex items-center gap-2">
          <svg class="w-5 h-5 fill-current text-peya-navy-70" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M5.51914 2C4.54897 2 3.73764 2.68233 3.53402 3.59551H2.04588C1.74444 3.59551 1.50008 3.84107 1.50008 4.14399C1.50008 4.44691 1.74444 4.69247 2.04588 4.69247H3.58921C3.85891 5.50374 4.62088 6.08866 5.51914 6.08866C6.4174 6.08866 7.17937 5.50374 7.44907 4.69247H13.9542C14.2556 4.69247 14.5 4.44691 14.5 4.14399C14.5 3.84107 14.2556 3.59551 13.9542 3.59551H7.50426C7.30064 2.68233 6.48931 2 5.51914 2ZM4.5764 4.04433C4.5764 3.52111 4.99848 3.09696 5.51914 3.09696C6.0398 3.09696 6.46188 3.52111 6.46188 4.04433C6.46188 4.56755 6.0398 4.99171 5.51914 4.99171C4.99848 4.99171 4.5764 4.56755 4.5764 4.04433Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M10.4809 6.12184C9.55835 6.12184 8.77952 6.73883 8.53015 7.58445H2.0458C1.74436 7.58445 1.5 7.83002 1.5 8.13293C1.5 8.43585 1.74436 8.68141 2.0458 8.68141L8.51177 8.68141C8.73909 9.56103 9.53437 10.2105 10.4809 10.2105C11.4274 10.2105 12.2227 9.56103 12.45 8.68141H13.9541C14.2556 8.68141 14.4999 8.43585 14.4999 8.13293C14.4999 7.83002 14.2556 7.58445 13.9541 7.58445H12.4317C12.1823 6.73883 11.4035 6.12184 10.4809 6.12184ZM9.53817 8.16617C9.53817 7.64295 9.96025 7.2188 10.4809 7.2188C11.0016 7.2188 11.4237 7.64295 11.4237 8.16617C11.4237 8.68939 11.0016 9.11355 10.4809 9.11355C9.96025 9.11355 9.53817 8.68939 9.53817 8.16617Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M5.51914 9.91133C4.52557 9.91133 3.69854 10.627 3.52033 11.5734H2.04588C1.74444 11.5734 1.50008 11.819 1.50008 12.1219C1.50008 12.4248 1.74444 12.6704 2.04588 12.6704H3.61262C3.90098 13.4468 4.6456 14 5.51914 14C6.39268 14 7.1373 13.4468 7.42566 12.6704H13.9542C14.2556 12.6704 14.5 12.4248 14.5 12.1219C14.5 11.819 14.2556 11.5734 13.9542 11.5734H7.51795C7.33974 10.627 6.51271 9.91133 5.51914 9.91133ZM4.5764 11.9557C4.5764 11.4324 4.99848 11.0083 5.51914 11.0083C6.0398 11.0083 6.46188 11.4324 6.46188 11.9557C6.46188 12.4789 6.0398 12.903 5.51914 12.903C4.99848 12.903 4.5764 12.4789 4.5764 11.9557Z"/></svg>
          Panel de Cohortes
        </h2>
        <div class="flex items-center gap-3">
          <div v-if="hasData" class="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
            <select v-model="promptType" class="text-xs border-none bg-transparent py-0 focus:ring-0 text-peya-navy-70 font-medium cursor-pointer">
              <option value="expansion">Evaluar Expansión (Feriados)</option>
              <option value="operaciones">Diagnóstico Operativo (FR & OT)</option>
              <option value="embudo">Análisis de Embudo (CVR)</option>
            </select>
            <button @click="copyPrompt" :disabled="isCopying" class="text-xs font-bold text-peya-informative hover:text-peya-navy-90 transition flex items-center gap-1">
              <svg class="w-3 h-3 fill-current" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M5.95153 5.24724C5.70896 5.24724 5.51169 5.44194 5.51169 5.68288L5.51168 7.42114C5.51168 7.66209 5.70895 7.85679 5.95152 7.85679C6.19409 7.85679 6.39136 7.66209 6.39136 7.42115L6.39136 5.68289C6.39136 5.44194 6.1941 5.24724 5.95153 5.24724Z"/><path d="M5.95153 8.14388C5.70896 8.14388 5.51169 8.33858 5.51169 8.57952L5.51168 10.3178C5.51168 10.5587 5.70895 10.7534 5.95152 10.7534C6.19409 10.7534 6.39136 10.5587 6.39136 10.3178L6.39136 8.57952C6.39136 8.33858 6.1941 8.14388 5.95153 8.14388Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M13.361 8.5753C13.3429 8.57149 13.325 8.56717 13.3073 8.56236C13.2832 8.55581 13.2595 8.54834 13.2363 8.54C12.8708 8.40899 12.61 8.06207 12.61 7.6559C12.61 7.2352 12.8898 6.87806 13.2759 6.75858C13.2891 6.75447 13.3025 6.75065 13.316 6.74711C13.3309 6.74322 13.3459 6.73968 13.361 6.73649C13.6637 6.67279 14 6.41027 14 5.99065V4.52508C14 4.10638 13.6432 3.77519 13.2219 3.80124L2.68681 4.45286C2.30108 4.47672 2 4.7934 2 5.1767V6.67847C2 7.09808 2.33631 7.3606 2.63899 7.42431C3.0684 7.51469 3.39004 7.89267 3.39004 8.34371C3.39004 8.79476 3.0684 9.17273 2.63899 9.26311C2.33631 9.32682 2 9.58934 2 10.009V11.4745C2 11.8932 2.35685 12.2244 2.77815 12.1984L13.3132 11.5467C13.6989 11.5229 14 11.2062 14 10.8229V9.32114C14 8.90153 13.6637 8.63901 13.361 8.5753ZM2.80358 6.65699C2.79926 6.65608 2.79531 6.65468 2.79188 6.65307L2.79188 5.23225L13.2081 4.58798L13.208 5.9653C13.2046 5.96689 13.2007 5.96827 13.1964 5.96917C12.4092 6.13485 11.8181 6.82641 11.8181 7.65585C11.8181 8.48529 12.4092 9.17684 13.1964 9.34253C13.2007 9.34343 13.2047 9.34483 13.2081 9.34644V10.7673L2.79189 11.4115L2.79197 10.0342C2.79537 10.0326 2.7993 10.0312 2.80358 10.0303C3.59077 9.86466 4.18192 9.1731 4.18192 8.34366C4.18192 7.51422 3.59077 6.82267 2.80358 6.65699Z"/></svg>
              {{ isCopying ? 'Copiando...' : 'Copiar Prompt' }}
            </button>
          </div>
          <button 
            @click="aplicarFiltros" 
            :disabled="isApplying"
            class="px-6 py-2 bg-peya-red-50 text-peya-white font-semibold rounded-lg hover:bg-peya-red-40 transition disabled:opacity-50 flex items-center gap-2">
            <span v-if="isApplying" class="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></span>
            {{ isApplying ? 'Calculando...' : 'Aplicar Filtros' }}
          </button>
        </div>
      </div>

      <!-- FILTROS GLOBALES -->
      <div class="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
        <div>
          <label class="block text-xs font-semibold text-peya-navy-70 uppercase mb-1">Ciudades (Log)</label>
          <input v-model="globalFilters.cities" type="text" placeholder="Ej: Santiago, Antofagasta..." class="w-full text-sm border-slate-300 rounded-md shadow-sm focus:ring-peya-red-50 focus:border-peya-red-50" />
          <p class="text-[10px] text-peya-navy-60 mt-1">Separadas por coma</p>
        </div>
        <div>
          <label class="block text-xs font-semibold text-peya-navy-70 uppercase mb-1">Zonas (Log)</label>
          <input v-model="globalFilters.zones" type="text" placeholder="Ej: Las Condes, Centro..." class="w-full text-sm border-slate-300 rounded-md shadow-sm focus:ring-peya-red-50 focus:border-peya-red-50" />
        </div>
        <div>
          <label class="block text-xs font-semibold text-peya-navy-70 uppercase mb-1">Franquicia</label>
          <input v-model="globalFilters.franchises" type="text" placeholder="Ej: McDonald's..." class="w-full text-sm border-slate-300 rounded-md shadow-sm focus:ring-peya-red-50 focus:border-peya-red-50" />
        </div>
        <div>
          <label class="block text-xs font-semibold text-peya-navy-70 uppercase mb-1">Operación</label>
          <select v-model="globalFilters.logisticMarketplace" class="w-full text-sm border-slate-300 rounded-md shadow-sm focus:ring-peya-red-50 focus:border-peya-red-50">
            <option :value="null">Ambos (Sin filtro)</option>
            <option value="Logistic">Logistic</option>
            <option value="Marketplace">Marketplace</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-semibold text-peya-navy-70 uppercase mb-1">Ubicación</label>
          <select v-model="globalFilters.isMall" class="w-full text-sm border-slate-300 rounded-md shadow-sm focus:ring-peya-red-50 focus:border-peya-red-50">
            <option :value="null">Todos (Sin filtro)</option>
            <option :value="true">Solo Malls</option>
            <option :value="false">No Malls (Calle)</option>
          </select>
        </div>
      </div>

      <!-- GESTIÓN DE GRUPOS -->
      <div class="flex items-center gap-3 mb-4">
        <h3 class="text-sm font-bold text-peya-navy-90 uppercase">Grupos de Comparación ({{ storeState.groups.length }}/4)</h3>
        <button v-if="storeState.groups.length < 4" @click="agregarGrupo" class="text-xs bg-transparent border border-peya-navy-60 text-peya-navy-90 hover:bg-slate-100 px-3 py-1 rounded-full font-medium transition flex items-center gap-1">
          <svg class="w-3 h-3 fill-current" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M7.37019 2.73075C7.37019 2.32717 7.69736 2 8.10095 2C8.50453 2 8.8317 2.32717 8.8317 2.73075L8.8317 7.1683L13.2692 7.1683C13.6728 7.1683 14 7.49547 14 7.89906C14 8.30264 13.6728 8.62981 13.2692 8.62981H8.8317L8.8317 13.2692C8.8317 13.6728 8.50453 14 8.10094 14C7.69736 14 7.37019 13.6728 7.37019 13.2692L7.37019 8.62981H2.73075C2.32717 8.62981 2 8.30264 2 7.89906C2 7.49547 2.32717 7.1683 2.73075 7.1683H7.37019L7.37019 2.73075Z"/></svg>
          Añadir Grupo
        </button>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
        <div v-for="(group, index) in storeState.groups" :key="group.id" class="border border-slate-200 rounded-xl p-4 relative bg-slate-50">
          <button v-if="storeState.groups.length > 1" @click="removerGrupo(group.id)" class="absolute top-3 right-3 text-peya-navy-60 hover:text-peya-red-50 transition">
            <svg class="w-4 h-4 fill-current" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M2.74465 2.73766C3.06852 2.42078 3.59193 2.42078 3.91579 2.73766L8.11718 6.84831L12.0842 2.96695C12.4081 2.65007 12.9315 2.65007 13.2554 2.96695C13.5815 3.2861 13.5815 3.80532 13.2553 4.12448L9.29429 8L13.2553 11.8755C13.5815 12.1947 13.5815 12.7139 13.2553 13.0331C12.9315 13.3499 12.4081 13.3499 12.0842 13.0331L8.11717 9.15169L3.9158 13.2623C3.59193 13.5792 3.06852 13.5792 2.74465 13.2623C2.41845 12.9432 2.41845 12.424 2.74465 12.1048L6.94006 8L2.74465 3.89518C2.41845 3.57603 2.41845 3.05681 2.74465 2.73766Z"/></svg>
          </button>
          
          <input v-model="group.label" type="text" class="font-bold text-peya-navy-90 bg-transparent border-none p-0 focus:ring-0 mb-3 w-4/5" />
          
          <div class="mb-3">
            <label class="block text-[11px] font-semibold text-peya-navy-70 uppercase mb-1">Modo Temporal</label>
            <select v-model="group.ui.timeMode" class="w-full text-xs border-slate-300 rounded-md shadow-sm py-1 focus:ring-peya-red-50 focus:border-peya-red-50">
              <option value="dates">Rango de Fechas Exactas</option>
              <option value="weeks">Semanas</option>
              <option value="months">Meses</option>
              <option value="dow">Días de la Semana</option>
            </select>
          </div>

          <!-- Fechas Exactas -->
          <div v-if="group.ui.timeMode === 'dates'" class="flex gap-2">
            <div class="w-1/2">
              <label class="block text-[10px] text-peya-navy-60 mb-1">Desde</label>
              <input v-model="group.rangoTemporal.fromDate" type="date" class="w-full text-xs border-slate-300 rounded p-1 focus:ring-peya-red-50 focus:border-peya-red-50" />
            </div>
            <div class="w-1/2">
              <label class="block text-[10px] text-peya-navy-60 mb-1">Hasta</label>
              <input v-model="group.rangoTemporal.toDate" type="date" class="w-full text-xs border-slate-300 rounded p-1 focus:ring-peya-red-50 focus:border-peya-red-50" />
            </div>
          </div>

          <!-- Otros modos (Placeholder UI para extensión lógica temporal) -->
          <div v-else class="text-xs text-peya-navy-70 bg-peya-deals-comms/20 p-2 rounded border border-peya-deals-comms/40">
            * El modo <b>{{ group.ui.timeMode }}</b> requiere lógica auxiliar para mapear a fromDate/toDate.
          </div>

          <!-- Loading State Local -->
          <div v-if="group.loading" class="mt-4 p-3 bg-peya-background rounded-lg flex items-center justify-center gap-2 border border-slate-200">
            <span class="animate-spin h-3 w-3 border-2 border-peya-red-50 border-t-transparent rounded-full"></span>
            <span class="text-xs text-peya-navy-90 font-medium">Consultando BQ...</span>
          </div>
          
          <div v-if="group.error" class="mt-4 p-2 bg-peya-red-20/20 text-peya-red-70 text-[10px] rounded border border-peya-red-20">
            {{ group.error }}
          </div>
        </div>
      </div>
    </div>
  `,
  setup() {
    const { reactive, ref, onMounted } = Vue;
    const storeState = Store.state;
    const isApplying = ref(false);

    // Estado local de los filtros de la barra superior
    const globalFilters = reactive({
      cities: '',
      zones: '',
      franchises: '',
      logisticMarketplace: null,
      isMall: null
    });

    // Inicializar un grupo por defecto
    onMounted(() => {
      if (storeState.groups.length === 0) {
        agregarGrupo();
      }
    });

    const agregarGrupo = () => {
      Store.addGroup('Cohorte ' + (storeState.groups.length + 1), {}, { 
        fromDate: '2026-01-01', 
        toDate: '2026-01-31' 
      });
      // Añadimos propiedad UI específica para este componente
      const nuevo = storeState.groups[storeState.groups.length - 1];
      nuevo.ui = { timeMode: 'dates' };
    };

    const removerGrupo = (id) => Store.removeGroup(id);

    // Helpers para parsear inputs crudos a arrays[cite: 3]
    const parseList = (str) => str.split(',').map(s => s.trim()).filter(s => s.length > 0);

    const aplicarFiltros = async () => {
      isApplying.value = true;
      
      const payloadBase = {
        cities: parseList(globalFilters.cities),
        zones: parseList(globalFilters.zones),
        franchises: parseList(globalFilters.franchises),
        logisticMarketplace: globalFilters.logisticMarketplace,
        isMall: globalFilters.isMall
      };

      // Disparar peticiones asíncronas para cada grupo
      const promises = storeState.groups.map(group => {
        return new Promise((resolve) => {
          group.loading = true;
          group.error = null;

          // Combinar filtros globales con el rango temporal del grupo
          const reqPayload = {
            ...payloadBase,
            fromDate: group.rangoTemporal.fromDate,
            toDate: group.rangoTemporal.toDate
          };

          google.script.run
            .withSuccessHandler((responseString) => {
              group.loading = false;
              
              // Descomprime el texto a un arreglo de objetos
              const data = JSON.parse(responseString);
              console.log(`Grupo ${group.id} recibió ${data.length} filas.`);
              
              Store.setGroupRawData(group.id, data);
              resolve({ success: true, id: group.id });
            })
            .withFailureHandler((err) => {
              group.loading = false;
              group.error = err.message;
              console.error('Error BQ Grupo', group.id, err);
              resolve({ success: false, id: group.id });
            })
            .fetchDashboardData(reqPayload); // Llama a Controller.gs
        });
      });

      await Promise.all(promises);
      isApplying.value = false;
    };

    // --- LÓGICA DE EXTRACCIÓN PARA IA ---
    const hasData = Vue.computed(() => storeState.groups.some(g => g.aggregatedData && g.aggregatedData.timeSeries.length > 0));
    const promptType = ref('expansion');
    const isCopying = ref(false);

    const copyPrompt = async () => {
      isCopying.value = true;
      try {
        const prompts = {
          expansion: "Actúa como Estratega de Expansión y Operaciones. Nuestro objetivo es decidir si debemos operar durante Fiestas Patrias (u otro feriado crítico) en una ciudad donde históricamente hemos apagado la operación. Analiza la resiliencia operativa (caída de open_time_pct y aumento de fail_rate) y la elasticidad de la demanda (city_total_sessions) en los escenarios proxy adjuntos. Proyecta qué pasaría si abrimos esta ciudad. Dame un veredicto definitivo: ABRIR, CERRAR, o ABRIR CON CONDICIONES (y cuáles).",
          operaciones: "Actúa como un Analista de Datos Senior. Cruza las métricas de degradación operativa (fail_rate y open_time_pct) con el volumen de confirmed_orders para cada cohorte adjunta. Determina si existe una correlación estadísticamente relevante entre el incumplimiento de horarios o los rechazos de órdenes y la pérdida general de volumen. Señala el día o grupo con la anomalía operativa más crítica.",
          embudo: "Actúa como un Analista de Datos Senior. Adjunto un dataset en formato JSON con el rendimiento de múltiples cohortes. Analiza la evolución del embudo de conversión utilizando las métricas de city_cvr_2, city_cvr_3 y city_cvr_neto. Identifica en qué etapa exacta se genera la mayor fricción y propón 3 hipótesis concretas (operativas o de catálogo) que expliquen la caída entre los grupos."
        };

        const dataToCopy = storeState.groups.map(g => ({
          cohorte: g.label,
          parametros_aplicados: { ...globalFilters, desde: g.rangoTemporal.fromDate, hasta: g.rangoTemporal.toDate },
          resumen_diario: g.aggregatedData.timeSeries
        }));

        const finalString = `${prompts[promptType.value]}\n\n### DATASET (JSON)\n\`\`\`json\n${JSON.stringify(dataToCopy, null, 2)}\n\`\`\``;
        
        await navigator.clipboard.writeText(finalString);
        alert('¡Prompt y dataset copiados al portapapeles! Pégalo en tu IA de preferencia.');
      } catch (err) {
        console.error(err);
        alert('Error al copiar al portapapeles. Permisos denegados.');
      }
      isCopying.value = false;
    };

    return {
      storeState,
      globalFilters,
      isApplying,
      agregarGrupo,
      removerGrupo,
      aplicarFiltros,
      hasData,
      promptType,
      isCopying,
      copyPrompt
    };
  }
};
</script>
```

## File: UI_Table.html
```html
<script>
/**
 * Componente Vue: UI_Table
 * Tabla de ranking a nivel de partner con virtual/sticky scrolling,
 * pestañas por grupo y ordenamiento dinámico.
 */
const UI_Table = {
  template: `
        <div v-if="anyLoading" class="w-full max-w-7xl mx-auto bg-white shadow-sm rounded-xl border border-slate-200 p-8 mb-12 text-center text-sm text-slate-400">
      Cargando ranking de partners…
    </div>
    <div v-else-if="anyError" class="w-full max-w-7xl mx-auto bg-white shadow-sm rounded-xl border border-red-200 p-8 mb-12 text-center text-sm text-red-600">
      {{ anyError }}
    </div>
    <div v-else-if="groupsWithData.length > 0" class="w-full max-w-7xl mx-auto bg-white shadow-sm rounded-xl border border-slate-200 overflow-hidden mb-12">
      
      <!-- HEADER & TABS -->
      <div class="px-6 pt-6 border-b border-slate-200">
        <h2 class="text-xl font-bold text-slate-800 mb-4">Ranking de Partners</h2>
        <div class="flex gap-4 overflow-x-auto">
          <button 
            v-for="group in groupsWithData" 
            :key="group.id"
            @click="activeGroupId = group.id"
            :class="[
              'pb-3 px-1 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
              activeGroupId === group.id 
                ? 'border-blue-600 text-blue-600' 
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            ]"
          >
            {{ group.label }}
          </button>
        </div>
      </div>

      <!-- TABLA -->
      <div class="overflow-x-auto max-h-[600px]">
        <table class="min-w-full text-left text-sm text-slate-600">
          <thead class="bg-slate-50 text-xs uppercase font-semibold text-slate-500 sticky top-0 shadow-sm z-10">
            <tr>
              <th v-for="col in columns" :key="col.key" @click="sortBy(col.key)" class="px-4 py-3 cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap">
                <div class="flex items-center gap-1">
                  {{ col.label }}
                  <span v-if="sortKey === col.key" class="text-peya-red-50 flex items-center">
                    <svg v-if="sortAsc" class="w-3 h-3 fill-current" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M13.2231 6.81308C13.459 7.04136 13.459 7.41137 13.2231 7.63965C12.9872 7.86803 12.6046 7.86803 12.3686 7.63965L8.81235 4.19761C8.77696 4.16336 8.72447 4.15357 8.67907 4.17273C8.63367 4.1919 8.60417 4.23632 8.60417 4.2855L8.60417 13.4154C8.60417 13.7379 8.33402 14 8.00002 14C7.66603 14 7.39588 13.7379 7.39588 13.4154L7.39588 4.2855C7.39588 4.23632 7.36638 4.1919 7.32098 4.17273C7.27558 4.15357 7.22308 4.16336 7.1877 4.19761L3.63142 7.63965C3.39547 7.86803 3.01287 7.86803 2.77691 7.63965C2.54106 7.41137 2.54106 7.04136 2.77691 6.81308L7.57277 2.17128C7.68083 2.06669 7.82983 2.00147 7.99448 2.00003L7.99949 2L8.00056 2L8.0056 2.00003C8.08533 2.00076 8.16173 2.01646 8.23134 2.0444C8.30263 2.07296 8.36945 2.1153 8.42728 2.17128L13.2231 6.81308Z"/></svg>
                    <svg v-else class="w-3 h-3 fill-current" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M2.77687 9.18692C2.54101 8.95864 2.54101 8.58863 2.77687 8.36035C3.01282 8.13197 3.39542 8.13197 3.63137 8.36035L7.18765 11.8024C7.22304 11.8366 7.27553 11.8464 7.32093 11.8273C7.36633 11.8081 7.39583 11.7637 7.39583 11.7145L7.39583 2.58457C7.39583 2.26206 7.66598 2 7.99998 2C8.33397 2 8.60412 2.26206 8.60412 2.58457L8.60412 11.7145C8.60412 11.7637 8.63362 11.8081 8.67902 11.8273C8.72442 11.8464 8.77692 11.8366 8.8123 11.8024L12.3686 8.36035C12.6045 8.13197 12.9871 8.13197 13.2231 8.36035C13.4589 8.58863 13.4589 8.95864 13.2231 9.18692L8.42723 13.8287C8.31917 13.9333 8.17017 13.9985 8.00552 14L8.00051 14L7.99944 14L7.9944 14C7.91467 13.9992 7.83827 13.9835 7.76866 13.9556C7.69737 13.927 7.63055 13.8847 7.57272 13.8287L2.77687 9.18692Z"/></svg>
                  </span>
                </div>
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="partner in sortedPartners" :key="partner.vendor_code" class="hover:bg-slate-50 transition-colors">
              <td class="px-4 py-2 font-medium text-peya-navy-90">{{ partner.vendor_code }}</td>
              <td class="px-4 py-2 font-medium text-peya-navy-90 truncate max-w-[200px]" :title="partner.partner_name">{{ partner.partner_name }}</td>
              <td class="px-4 py-2 truncate max-w-[150px]">{{ partner.franchise_name }}</td>
              <td class="px-4 py-2">
                <span :class="['px-2 py-1 text-[10px] rounded-full font-medium', partner.is_logistic_marketplace === 'Logistic' ? 'bg-purple-100 text-purple-700' : 'bg-orange-100 text-orange-700']">
                  {{ partner.is_logistic_marketplace }}
                </span>
              </td>
              <td class="px-4 py-2 text-center">
                <svg v-if="partner.is_mall" class="w-4 h-4 mx-auto fill-current text-peya-positive" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10.8152 5.74029C10.5871 5.55592 10.2522 5.59046 10.0669 5.81785L6.99035 9.73215L5.84179 8.50727L5.82882 8.49806C5.58973 8.32827 5.25765 8.38349 5.0869 8.62204C4.91871 8.85702 4.97011 9.18174 5.19964 9.35417L6.75022 10.9059L6.76112 10.9136C6.98975 11.076 7.30572 11.0335 7.48291 10.816L10.8939 6.4862C11.0785 6.25846 11.0432 5.92467 10.8152 5.74029Z"/>
                  <path fill-rule="evenodd" clip-rule="evenodd" d="M8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5ZM2.53497 8C2.53497 4.98175 4.98175 2.53497 8 2.53497C11.0183 2.53497 13.465 4.98175 13.465 8C13.465 11.0183 11.0183 13.465 8 13.465C4.98175 13.465 2.53497 11.0183 2.53497 8Z"/>
                </svg>
                <span v-else class="text-peya-navy-60">-</span>
              </td>
              <td class="px-4 py-2 text-right">{{ formatNum(partner.total_orders) }}</td>
              <td class="px-4 py-2 text-right text-red-600">{{ formatNum(partner.rejected_orders) }}</td>
              <td class="px-4 py-2 text-right font-medium">{{ formatPct(partner.fail_rate) }}</td>
              <td class="px-4 py-2 text-right">{{ formatPct(partner.open_time_pct) }}</td>
              <td class="px-4 py-2 text-right text-blue-600 font-medium">{{ formatPct(partner.share_over_group) }}</td>
              <td class="px-4 py-2 text-right text-emerald-600 font-medium">{{ formatPct(partner.penetracion) }}</td>
            </tr>
            <tr v-if="sortedPartners.length === 0">
              <td colspan="11" class="px-4 py-8 text-center text-slate-400">No hay datos para mostrar en este grupo.</td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  `,
  setup() {
    const { computed, ref, watch } = Vue;
    const storeState = Store.state;

    const activeGroupId = ref(null);
    const sortKey = ref('total_orders');
    const sortAsc = ref(false); // Por defecto descendente (los mejores primero)

    const columns = [
      { key: 'vendor_code', label: 'ID' },
      { key: 'partner_name', label: 'Nombre' },
      { key: 'franchise_name', label: 'Franquicia' },
      { key: 'is_logistic_marketplace', label: 'Operación' },
      { key: 'is_mall', label: 'Mall' },
      { key: 'total_orders', label: 'Órdenes' },
      { key: 'rejected_orders', label: 'Rechazos' },
      { key: 'fail_rate', label: 'Fail Rate' },
      { key: 'open_time_pct', label: 'Open Time' },
      { key: 'share_over_group', label: 'Share (Grupo)' },
      { key: 'penetracion', label: 'Penetración (Ciudad)' }
    ];

    const groupsWithData = computed(() => {
      return storeState.groups.filter(g => g.aggregatedData && g.aggregatedData.partnerTotals.length > 0);
    });

    // NOTA: asume que Store.html define group.loading (boolean) y group.error
    // (string|null) por grupo — confirmar contra la versión actual de Store.html.
    const anyLoading = computed(() => storeState.groups.some(g => g.loading));
    const anyError = computed(() => {
      const withError = storeState.groups.find(g => g.error);
      return withError ? withError.error : null;
    });

        // Auto-seleccionar la primera pestaña si no hay ninguna activa o si se borra el grupo activo.
    // Sin deep: groupsWithData ya es un computed reactivo sobre storeState.groups
    // (Vue trackea sus dependencias finas solo); no hace falta re-trazar cada
    // campo de cada fila de rawData en cada ciclo.
    watch(groupsWithData, (newGroups) => {
      if (newGroups.length > 0 && (!activeGroupId.value || !newGroups.find(g => g.id === activeGroupId.value))) {
        activeGroupId.value = newGroups[0].id;
      }
    }, { immediate: true });

    const activeGroupData = computed(() => {
      const group = groupsWithData.value.find(g => g.id === activeGroupId.value);
      return group ? group.aggregatedData.partnerTotals : [];
    });

    const sortedPartners = computed(() => {
      let data = [...activeGroupData.value];
      if (!sortKey.value) return data;

      data.sort((a, b) => {
        let valA = a[sortKey.value];
        let valB = b[sortKey.value];

        // Manejar nulos para que siempre queden al final
        if (valA === null || valA === undefined) valA = sortAsc.value ? Infinity : -Infinity;
        if (valB === null || valB === undefined) valB = sortAsc.value ? Infinity : -Infinity;

        if (valA < valB) return sortAsc.value ? -1 : 1;
        if (valA > valB) return sortAsc.value ? 1 : -1;
        return 0;
      });

      return data;
    });

    const sortBy = (key) => {
      if (sortKey.value === key) {
        sortAsc.value = !sortAsc.value;
      } else {
        sortKey.value = key;
        sortAsc.value = false; // Al cambiar de columna, ordenar descendente por defecto
      }
    };

    const formatNum = (val) => val === null || val === undefined ? '-' : val.toLocaleString('es-CL');
    const formatPct = (val) => val === null || val === undefined ? '-' : (val * 100).toFixed(2) + '%';

      return {
      groupsWithData,
      anyLoading,
      anyError,
      activeGroupId,
      columns,
      sortedPartners,
      sortKey,
      sortAsc,
      sortBy,
      formatNum,
      formatPct
    };
  }
};
</script>
```

## File: Index.html
```html
<!DOCTYPE html>
<html lang="es">
<head>
  <base target="_top">
  <meta charset="UTF-8">
  <title>Dates Analytics Log</title>

  <!-- Tipografía Oficial PeYa -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <!-- Tailwind CSS -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: { sans: ['Outfit', 'sans-serif'] },
          colors: {
            peya: {
              'red-50': '#EA044E', 'red-40': '#EC1D60', 'red-70': '#B40443', 'red-20': '#F481A6',
              'navy-90': '#100423', 'navy-70': '#4C4359', 'navy-60': '#70697A',
              'informative': '#04ADDF', 'deals-comms': '#F8EA46', 'accent': '#72E6FF',
              'positive': '#2DE1A0', 'background': '#F8F9FA', 'white': '#FFFFFF'
            }
          }
        }
      }
    }
  </script>

  <!-- Vue 3 -->
  <script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"></script>

  <!-- Apache ECharts -->
  <script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>

  <?!= include('Styles'); ?>
</head>
<body class="bg-peya-background text-peya-navy-90 font-sans">

  <div id="app" class="min-h-screen p-8 flex flex-col items-center">
    <div class="w-full max-w-7xl flex items-center gap-3 mb-6">
      <svg class="w-8 h-8 fill-current text-peya-red-50" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
        <path d="M9.67491 2.8999H9.553H9.00353H2.67668C2.5791 2.8999 2.5 2.97728 2.5 3.07274V4.05789C2.5 5.13292 3.27562 5.72574 4.68375 5.72574H9.67491C10.1863 5.74726 10.5897 6.15914 10.5897 6.65991C10.5897 7.16068 10.1863 7.57255 9.67491 7.59408H4.07951C3.99601 7.59794 3.92671 7.65852 3.91343 7.73926L2.58304 12.85C2.56963 12.9017 2.58137 12.9565 2.61484 12.9986C2.6482 13.041 2.69974 13.0659 2.75442 13.066H4.5212C5.0233 13.0557 5.45682 12.7193 5.58127 12.2433L6.11131 10.3836H9.67491C11.7874 10.3836 13.5 8.70833 13.5 6.64176C13.5 4.57519 11.7874 2.8999 9.67491 2.8999Z"/>
      </svg>
      <h1 class="text-2xl font-bold tracking-tight">{{ titulo }}</h1>
    </div>
    
    <!-- Renderizado del componente Fase 3 -->
    <ui-filters></ui-filters>
    <!-- Renderizado del componente Fase 4 -->
    <ui-charts></ui-charts>
    <!-- Renderizado del componente Fase 5 -->
    <ui-table></ui-table>

  </div>

  <!-- 1. Cargar el motor matemático primero -->
  <?!= include('Store'); ?>
  
  <!-- 2. Cargar los componentes visuales -->
  <?!= include('UI_Filters'); ?>

  <!-- 3. Cargar los componentes visuales -->
  <?!= include('UI_Charts'); ?>

  <!-- 4. Cargar los componentes visuales -->
  <?!= include('UI_Table'); ?>

  <script>
    const { createApp, ref } = Vue;

    const app = createApp({
      setup() {
        const titulo = ref('Dates Analytics Log');
        return { titulo };
      }
    });

    // 3. Registrar el componente globalmente en Vue
    app.component('ui-filters', UI_Filters);
    app.component('ui-charts', UI_Charts);
    app.component('ui-table', UI_Table);

    // 4. Montar la app
    app.mount('#app');
  </script>

</body>
</html>
```
