# Contexto del Proyecto
Se requiere construir una WebApp SPA (Single Page Application) alojada en Google Apps Script (GAS) que consuma datos desde BigQuery. El objetivo es un dashboard analítico altamente interactivo de comparación de cohortes (grupos) con calidad Enterprise (UI/UX fluido, Material Design/Tailwind, gráficos dinámicos).

## 1. Arquitectura Base
*   **Backend (GAS):** Solo servirá la estructura HTML inicial y expondrá funciones `google.script.run` para consultar BigQuery. Deberá devolver un arreglo de objetos JSON planos.
*   **Frontend (Cliente):** Framework reactivo (Vue.js 3 o React) manejando estado local. Librería de gráficos robusta (ApexCharts o Apache ECharts). Framework CSS para UI (Tailwind CSS o Vuetify/MUI).
*   **Gestión de Estado:** Al dar clic en "Aplicar", se trae el dataset bruto del servidor. Cualquier interacción posterior (cambio de ejes, agrupar fechas, tipo de gráfico, mostrar/ocultar series) mutará la vista usando los datos en memoria, sin peticiones al servidor.

## 2. Origen de Datos (Dataset)
El backend entregará un JSON con la granularidad `partner_id` + `fecha`.
Columnas disponibles:
`vendor_code`, `partner_name`, `franchise_name`, `is_logistic_marketplace`, `is_mall`, `mall_name`, `ciudad`, `zone_name`, `city_name_log`, `zone_name_log`, `fecha`, `is_active_partner`, `plan_open_time_minutes`, `real_open_time_minutes`, `total_orders`, `confirmed_orders`, `rejected_orders`, `has_orders`, `city_total_sessions_raw`, `city_sessions_shop_list`, `city_sessions_shop_details`, `city_sessions_checkout`, `city_sessions_with_orders`.

**⚠️ REGLAS MATEMÁTICAS ESTRICTAS PARA EL FRONTEND (AGREGACIÓN):**
1.  **CVRs y Ratios:** Jamás promediar porcentajes. Calcular dinámicamente sumando numeradores y denominadores:
    *   `Fail Rate` = `SUM(rejected_orders) / SUM(total_orders)`
    *   `Open Time %` = `SUM(real_open_time_minutes) / SUM(plan_open_time_minutes)`
2.  **Sesiones de la Ciudad:** El campo `city_total_sessions_raw` se repite para cada local. Para saber el tráfico total de la ciudad en un grupo, el frontend DEBE desduplicar por la llave `ciudad`+`fecha` antes de sumar. No sumar ciegamente la columna.

## 3. Historias de Usuario y Funcionalidades Core

### A. Panel de Configuración Global y Creación de Grupos
*   **Filtros Globales:** Dropdowns múltiples para `city_name_log`, `zone_name_log`, `franchise_name`, Toggle `Logistic/Marketplace`, Toggle `Mall/No Mall`. Si están vacíos, no filtran.
*   **Gestor de Grupos (2 a 4 máximo):** Interfaz para añadir grupos de comparación. Cada grupo hereda los filtros globales pero puede tener overrides locales (ej: Grupo 1 = Mall, Grupo 2 = No Mall).
*   **Selector Temporal por Grupo:**
    *   *Fechas Específicas:* Rango de fechas libre en calendario.
    *   *Día de la semana:* Checkbox de días (ej. Viernes) + selección de Semanas del año.
    *   *Semanas:* Selector de una o múltiples semanas.
    *   *Meses:* Selector de meses (ej. 2026-03).
*   **Botón Aplicar:** Dispara la carga (mostrar Skeleton Loaders mientras resuelve BigQuery).

### B. Visualización Gráfica (Charts)
*   Renderizar un gráfico por grupo, alineados horizontalmente.
*   **Botón "Fusionar":** Permite superponer las series de todos los grupos en un solo gráfico grande.
*   **Controles en tiempo real por gráfico:**
    *   Selector de métricas activas (Sesiones, CVR1, CVR2, CVR3, Orders, Fail Rate, etc.).
    *   Selector de eje Y (Izquierda o Derecha). El eje X siempre es temporal.
    *   Selector de visualización: Área, Línea, Barra.
    *   Agrupación Temporal: Desagrupar por granularidad nativa (Día) o ver totales agregados del periodo.
    *   Toggle de Data Labels.
*   **Breakdowns Analíticos:** Capacidad de dividir una métrica de un grupo por una dimensión categórica (`is_mall`, `is_logistic_marketplace`) mostrando valores absolutos o calculando el Share (%).
*   **Sincronización:** Los tooltips (hover) deben sincronizarse a través de los gráficos separados para el mismo punto del eje X.

### C. Ranking de Partners (Tabla Dinámica)
*   Ubicada bajo los gráficos, segmentada en pestañas por Grupo (o una tabla anidada).
*   Métricas agregadas a nivel `vendor_code` para el periodo evaluado.
*   Métricas a renderizar: `id`, `name`, `total_orders`, `rejected_orders`, `fail rate %`, `open time compliance %`, `is_mall`, `is_logistic_marketplace`.
*   **Métricas Dinámicas Calculadas:**
    *   *Penetración:* Órdenes del partner / Total sesiones ciudad desduplicadas del periodo.
    *   *Share over group:* Órdenes del partner / Sumatoria de órdenes de todos los partners renderizados en ese grupo.
*   **UI Tabla:** Virtual scrolling, cabeceras fijas (sticky header), ordenamiento por columnas (sortable) descendente/ascendente.
*   
---

# Arquitectura Modular del Dashboard en GAS

## 🗄️ Backend (Google Apps Script - Archivos .gs)
Estos archivos se ejecutan en los servidores de Google. Su único rol es entregar la web y comunicarse con BigQuery.

*   **`Config.gs`**
    *   Contiene el objeto `BQ_CONFIG` (IDs de proyecto, nombres de tablas).
    *   Variables de entorno y constantes.
*   **`Main.gs`**
    *   Función `doGet(e)` para renderizar la WebApp.
    *   Función helper `include(filename)` para inyectar los archivos HTML de forma modular.
*   **`Controller.gs`**
    *   Expone las funciones públicas para el frontend (ej. `fetchDashboardData(filters)`).
    *   Maneja la validación de los filtros recibidos antes de pasarlos a BigQuery.
*   **`Service_BigQuery.gs`**
    *   Contiene la función `_fetchAndAppendChunks` o la lógica nativa de `BigQuery.Jobs.query`.
    *   **Aquí vive tu Query Maestra**. Recibe los parámetros, ejecuta la consulta y formatea la respuesta en un JSON limpio (array de objetos).

## 💻 Frontend (Cliente - Archivos .html)
Se ejecutan en el navegador del usuario. Utilizan librerías vía CDN (ej. Vue.js, TailwindCSS, ApexCharts) para evitar configuraciones complejas de Node.js/Webpack, pero manteniendo reactividad.

*   **`Index.html`**
    *   El esqueleto principal de la app.
    *   Carga los CDNs (Vue, librerías de gráficos, CSS).
    *   Usa los tags `<?!= include('NombreArchivo'); ?>` para importar el resto del código frontend.
*   **`Styles.html`**
    *   Configuración de TailwindCSS o tus estilos CSS personalizados (`<style>`).
*   **`Store.html`** *(El "Cerebro" del Frontend)*
    *   Lógica pura de JavaScript (`<script>`).
    *   Contiene el estado reactivo (los datos crudos descargados de BigQuery).
    *   **Crucial:** Aquí viven las funciones matemáticas complejas que filtran la data en memoria, desduplican sesiones de la ciudad y calculan los CVRs dinámicos al vuelo.
*   **`UI_Filters.html`**
    *   Componente visual de la barra de filtros globales, selectores de fecha, comparador de cohortes y el botón "Aplicar".
*   **`UI_Charts.html`**
    *   Componente que escucha los cambios en `Store.html` y renderiza o actualiza los gráficos (áreas, barras, ejes sincronizados).
*   **`UI_Table.html`**
    *   Componente del Ranking de locales inferior.
    *   Maneja el formateo de números (ej. porcentajes, decimales) y el ordenamiento (sort) de las columnas.