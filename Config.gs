/**
 * Config.gs
 * Configuración central del proyecto. Nada de valores de negocio hardcodeados aquí abajo:
 * fechas, ciudades, zonas, etc. siempre llegan como parámetros desde el frontend.
 */

const BQ_CONFIG = {
  PROJECT_ID: 'peya-bi-tools-pro',
  // TODO Fase 1: confirmar dataset/tabla exactos de la Query Maestra
  DATASET: '',
  TABLE: '',
  LOCATION: 'US' // ajustar según la región real del dataset en BigQuery
};

// Rango de fechas por defecto SOLO para pruebas locales en Fase 0.
// En Fase 1 esto deja de usarse: el rango real llega en el objeto `filters`
// desde UI_Filters.html -> Controller.fetchDashboardData(filters).
const DEFAULT_TEST_RANGE = {
  from: '2026-01-01',
  to: '2026-01-31'
};
