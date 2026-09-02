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
