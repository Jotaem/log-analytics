# BITACORA_REFACTOR.md — Sistema de Analytics

> Registro histórico de desarrollo del proyecto. Cada sesión de trabajo (con o sin IA) se registra como una entrada nueva, de la más reciente a la más antigua. Este archivo es la fuente de verdad de "qué se hizo, cuándo, y qué se decidió" — cualquier agente de IA debe leerlo antes de iniciar una tarea nueva (ver `AGENTS.md`, Fase 0 del protocolo de tareas).

---

## Cómo registrar una entrada nueva

Copia esta plantilla al inicio del archivo (justo debajo de este bloque de instrucciones) cada vez que cierres una sesión de trabajo:

```markdown
## [Fecha: AAAA-MM-DD] — [Título breve de la sesión]

- **Hora de inicio – Hora de cierre:** HH:MM – HH:MM
- **Duración total:** X horas
- **Fase / Subfase relacionada:** (según `plan-desarrollo-gas-bigquery.md`, ej. "Fase 0.2 — Esqueleto de BigQuery")
- **Objetivo de la sesión:** (una o dos frases)

### Archivos creados/modificados
- `ruta/archivo.ext` — qué cambió y por qué

### Decisiones tomadas
- Decisión 1 (ej. valor de umbral elegido, alcance definido, criterio de exclusión)

### Pendientes para la próxima sesión
- Pendiente 1

### Criterio de éxito de la subfase
- [ ] Cumplido / [ ] No cumplido — detalle
```

---

## Entradas

# 1. Instalar clasp (si no lo tienes)
npm install -g @google/clasp

# 2. Login con tu cuenta Google (abre el navegador)
clasp login

# 3. Clonar el proyecto GAS existente a una carpeta local
#    (el Script ID está en tu proyecto: Configuración del proyecto ⚙️ > ID del script)
mkdir log-analytics && cd log-analytics
clasp clone "190U-Bx8idFREr4_m85reklM_8I3xJ_Srq7WISYxmnIQW98cVuTgKsYfL" --rootDir ./src

# 4. Inicializar git y conectarlo a tu repo remoto
git init
echo "node_modules/
.clasp.json" > .gitignore
git add .
git commit -m "Fase 0: setup inicial - shell Vue/Tailwind/ECharts, doGet, Config"
git branch -M main
git remote add origin https://github.com/Jotaem/log-analytics.git
git push -u origin main

# 5. Para subir cambios locales a GAS
clasp push

# 6. Para bajar cambios hechos desde el editor web de GAS
clasp pull