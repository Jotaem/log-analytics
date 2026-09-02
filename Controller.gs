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
