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

    city_log_map AS (
      SELECT ciudad_perseus, ANY_VALUE(city_name_log) AS city_name_log
      FROM UNNEST([
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
        STRUCT('Concepción', 'Concepcion'),
        STRUCT('Talcahuano', 'Concepcion'),
        STRUCT('Coronel', 'Concepcion'),
        STRUCT('Chiguayante', 'Concepcion'),
        STRUCT('Hualpén', 'Concepcion'),
        STRUCT('Penco', 'Concepcion'),
        STRUCT('San Pedro de la Paz', 'Concepcion'),
        STRUCT('Tomé', 'Concepcion'),
        STRUCT('Padre Las Casas', 'Temuco'),
        STRUCT('Vilcún', 'Temuco'),
        STRUCT('Nueva Imperial', 'Temuco'),
        STRUCT('Carahue', 'Temuco'),
        STRUCT('Panguipulli', 'Valdivia')
      ])
      GROUP BY ciudad_perseus
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

    historical_partner_day AS (
      SELECT
        hp.restaurant_id AS partner_id,
        DATE(hp.full_date) AS fecha,
        SUM(COALESCE(hp.schedule_open_time, 0)) AS schedule_open_time,
        SUM(GREATEST(0, COALESCE(hp.schedule_open_time, 0) - COALESCE(hp.closed_times, 0))) AS real_open_time,
        MAX(CASE WHEN COALESCE(hp.schedule_open_time, 0) > 0 THEN 1 ELSE 0 END) AS is_active_partner
      FROM \`${BQ_CONFIG.TABLES.HISTORICAL_PARTNERS}\` hp
      WHERE DATE(hp.full_date) >= @from_date
        AND DATE(hp.full_date) <= @to_date
      GROUP BY 1, 2
    ),

    orders_by_partner_day AS (
      SELECT
        fo.restaurant.id AS partner_id,
        DATE(fo.registered_date) AS fecha,
        COUNT(DISTINCT fo.order_id) AS total_orders,
        COUNT(DISTINCT CASE WHEN fo.order_status = 'CONFIRMED' THEN fo.order_id END) AS confirmed_orders
      FROM \`${BQ_CONFIG.TABLES.ORDERS}\` fo
      WHERE DATE(fo.registered_date) >= @from_date
        AND DATE(fo.registered_date) <= @to_date
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
        COALESCE(log.city_name_log, clm.city_name_log) AS city_name_log,
        log.zone_name_log,
        COALESCE(log.total_rejected_orders, 0) AS rejected_orders,
        IF(m.mall_name IS NOT NULL, TRUE, FALSE) AS is_mall,
        COALESCE(m.mall_name, 'Sin Mall') AS mall_name,
        COALESCE(hp.schedule_open_time, 0) AS schedule_open_time,
        COALESCE(hp.real_open_time, 0) AS real_open_time,
        COALESCE(hp.is_active_partner, 0) AS is_active_partner,
        COALESCE(fo.total_orders, 0) AS total_orders,
        COALESCE(fo.confirmed_orders, 0) AS confirmed_orders
      FROM \`${BQ_CONFIG.TABLES.PARTNER}\` dp
      LEFT JOIN \`${BQ_CONFIG.TABLES.AREA}\` da ON dp.address.area_id = da.area_id
      LEFT JOIN historical_partner_day hp ON dp.partner_id = hp.partner_id
      LEFT JOIN city_log_map clm
        ON LOWER(TRIM(dp.city.name)) = LOWER(TRIM(clm.ciudad_perseus))
      LEFT JOIN orders_by_partner_day fo
        ON dp.partner_id = fo.partner_id
       AND hp.fecha = fo.fecha
      LEFT JOIN base_logistics log ON dp.partner_id = log.partner_id AND hp.fecha = log.fecha
      LEFT JOIN malls m 
        ON dp.address.longitude IS NOT NULL 
       AND dp.address.latitude IS NOT NULL 
       AND ST_CONTAINS(m.mall_polygon, ST_GEOGPOINT(dp.address.longitude, dp.address.latitude))
      WHERE (dp.country.country_code = 'CL' OR dp.country_id = @country_id)
        AND hp.fecha IS NOT NULL
      GROUP BY
        dp.city.name, da.area_name, hp.fecha, dp.partner_id, dp.partner_name,
        dp.franchise.franchise_name, dp.is_logistic, COALESCE(log.city_name_log, clm.city_name_log), log.zone_name_log,
        log.total_rejected_orders, m.mall_name, hp.schedule_open_time, hp.real_open_time,
        hp.is_active_partner, fo.total_orders, fo.confirmed_orders
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
      LEFT JOIN base_sessions s ON p.ciudad = s.ciudad AND p.fecha = s.fecha
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
