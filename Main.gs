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
