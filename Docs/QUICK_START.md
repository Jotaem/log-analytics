# QUICK_START.md — Guía de Despliegue en Google Apps Script (GAS)

Sigue estos pasos en orden exacto para montar tu entorno, habilitar los permisos necesarios y desplegar el dashboard de cohortes con éxito.

## Paso 1: Configurar el Proyecto y Habilitar BigQuery
1. Abre [script.google.com](https://script.google.com/) y crea un **Nuevo proyecto**.
2. Ponle nombre a tu proyecto (ej. "Dashboard Cohortes").
3. En la barra lateral izquierda, busca la sección **Servicios** y haz clic en el botón **+**.
4. Busca **BigQuery API**, selecciónala y haz clic en **Añadir**. *(Sin esto, la línea `BigQuery.Jobs.query` fallará)*[cite: 6].

## Paso 2: Crear el Backend (Archivos Script)
Elimina o renombra el archivo `Código.gs` predeterminado. Crea los siguientes archivos tipo **Secuencia de comandos (Script)** haciendo clic en el **+** de la sección Archivos:

*   **Config.gs**: Pega el código de configuración de variables y tablas[cite: 2].
*   **Main.gs**: Pega el código de la función `doGet(e)` y el helper `include()`[cite: 5].
*   **Controller.gs**: Pega el código de validación de filtros y `fetchDashboardData`[cite: 3].
*   **Service_BigQuery.gs**: Pega la query maestra y la lógica de paginación/ejecución[cite: 6].

*Nota: En Apps Script, el orden de creación de los archivos `.gs` no importa para la ejecución, ya que Google los compila todos en el mismo entorno.*

## Paso 3: Crear el Frontend (Archivos HTML)
Crea los siguientes archivos tipo **HTML** (haz clic en **+** > **HTML**). Asegúrate de que los nombres sean exactos, ya que la función `include()` es sensible a mayúsculas y minúsculas[cite: 5].

*   **Styles.html**: Pega la configuración de CSS/Tailwind[cite: 8].
*   **Store.html**: Pega todo el motor matemático y de estado reactivo[cite: 7].
*   **UI_Filters.html**: Pega el componente del panel de configuración y los inputs.
*   **UI_Charts.html**: Pega el componente de gráficos ECharts.
*   **UI_Table.html**: Pega el componente de la tabla de ranking.
*   **Index.html**: Pega el archivo principal que carga los scripts y monta la app en el div `#app`[cite: 4].

## Paso 4: Pruebas y Validación Temprana
1. Haz clic en **Guardar proyecto** (icono de disquete).
2. Para probar que el motor matemático quedó bien pegado, ve al archivo `Store.html`, pero en lugar de probarlo ahí, haz un despliegue de prueba.
3. Haz clic en **Implementar > Implementación de prueba** y abre el enlace web.
4. Presiona **F12** en tu navegador para abrir la consola, escribe `Store.runValidationTests()` y presiona Enter[cite: 7]. Debe decir "✅ Store.runValidationTests(): TODOS los casos pasaron"[cite: 7].

## Paso 5: Despliegue Oficial (Deploy)
1. En el editor de GAS, haz clic en el botón azul **Implementar** (arriba a la derecha) > **Nueva implementación**.
2. En "Seleccionar tipo", haz clic en el engranaje (⚙️) y elige **Aplicación web**.
3. **Descripción:** "v1.0 - Lanzamiento inicial".
4. **Ejecutar como:** Selecciona **Usuario que accede a la aplicación web**. *(Fundamental para que BigQuery use las credenciales de quien mira el dash, no las tuyas)*.
5. **Quién tiene acceso:** Selecciona **Cualquier usuario de su organización** (o el nivel de privacidad que requieras).
6. Haz clic en **Implementar**.
7. Te pedirá **Revisar permisos** la primera vez. Inicia sesión con tu cuenta de Google, ve a "Avanzado" y haz clic en "Ir a [Nombre de tu proyecto]". Otorga los permisos a BigQuery.
8. Copia el **URL de la aplicación web**. Este es el enlace definitivo para tus usuarios.