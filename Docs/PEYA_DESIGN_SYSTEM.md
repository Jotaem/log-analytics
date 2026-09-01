# 🎨 PeYa Design System - Guía de Desarrollo Frontend

Este documento establece las directrices de estilos corporativos de PeYa (basado en Fénix UI) para la creación de WebApps internas (Google Apps Script u otros frameworks).

## 1. Foundations (Fundamentos)

### 1.1 Tipografía

La familia tipográfica oficial de PeYa es **Outfit**.

- **Pesos permitidos:** Normal (400), Medium (500), Semibold (600), Bold (700), Extrabold (800).
- **Importación CDN (Google Fonts):**

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
```

### 1.2 Paleta de Colores (Variables CSS)

Integra siempre estas variables en la etiqueta `<style>` global de tu proyecto para asegurar coherencia visual.

```css
:root {
  /* Brand Colors (Rojos PeYa) */
  --peya-red-50: #EA044E; /* Color principal (Botones, Accents) */
  --peya-red-40: #EC1D60; /* Hover / Estados activos */
  --peya-red-70: #B40443; /* Focus / Estados presionados */
  --peya-red-20: #F481A6; /* Fondos tenues / Disabled brand */

  /* Navy Colors (Neutros y Textos) */
  --peya-navy-90: #100423; /* Títulos y textos principales */
  --peya-navy-70: #4C4359; /* Textos secundarios y descripciones */
  --peya-navy-60: #70697A; /* Borders / Textos deshabilitados */

  /* Semantic Colors (Feedback y Destaques) */
  --peya-informative: #04ADDF; /* Usado para banners informativos */
  --peya-deals-comms: #F8EA46; /* Ofertas y comunicaciones */
  --peya-accent: #72E6FF;      /* Acentos UI y llamadas de atención */
  --peya-positive: #2DE1A0;    /* Success / DMarts */

  /* Básicos */
  --peya-white: #FFFFFF;
  --peya-background: #F8F9FA;
}
```

## 2. Componentes UI (Guidelines)

### 2.1 Botones

Los botones deben ser consistentes y usar la paleta oficial:

- **Primary:** Fondo `--peya-red-50`, Texto Blanco. Hover: `--peya-red-40`.
- **Secondary / Ghost:** Fondo transparente, Borde `--peya-navy-60`, Texto `--peya-navy-90`.
- **Links:** Texto `--peya-red-50`, sin subrayado hasta el estado de hover.

### 2.2 Cards y Contenedores (Box)

- Fondo blanco (`--peya-white`), con bordes sutiles o sombras muy suaves para mantener la interfaz limpia y respirable.
- **Border-radius:** 8px o 12px.

### 2.3 Feedback y Alertas

- **Informativo:** Usar `--peya-informative`.
- **Positivo:** Usar `--peya-positive`.
- **Error:** Usar un derivado de `--peya-red-50`.
- **Warning:** Usar `--peya-deals-comms`.

## 3. Iconos coorporativos

- Todos los iconos coorporativos están en ICONOS.txt