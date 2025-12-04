# EPIBOT RELOADED ⚡ - ELECTRIC BOOGALOO

Un bot de Discord para cálculos y análisis epidemiológicos con interfaz amigable y resultados decorados.

## Características 🎯

- **Tabla 2x2** - Análisis de sensibilidad, especificidad, VPP, VPN
- **Medidas de Asociación** - RR, OR e IC 95%
- **Razones de Verosimilitud** - LR+, LR-, cálculos Bayesianos
- **Interpretaciones Chistosas** - Porque la epi también debe ser divertida
- **Insultos Suaves** - Apoyo emocional agresivo cuando lo necesites
- **Interfaz Rica** - Embeds coloridos, ASCII decorativo
- **Comandos**:
  - `!diag` - Análisis epidemiológico completo
  - `!bayes` - Cálculos Bayesianos rápidos
  - `!meta` - Explicaciones teóricas
  - `!lastdiag` - Ver tu último análisis
  - `!insultoepi` - Apoyo emocional epidemiológico
  - `/diagquick` - Slash command para análisis rápido
- **Exportación a Excel** - Descarga tus resultados en .xlsx

## Instalación 🔧

```bash
# Clonar el repositorio
git clone https://github.com/saffranina/epibot-reloaded-2-electric-boogaloo.git
cd epibot-reloaded-2-electric-boogaloo

# Crear entorno virtual
python -m venv .venv
source .venv/bin/activate  # En Windows: .venv\Scripts\activate

# Instalar dependencias
pip install -r requirements.txt
```

## Configuración 🔑

```bash
# Exportar tu token de Discord
export DISCORD_TOKEN="tu_token_aqui"

# Ejecutar el bot
python epibot2.py
```

## Requisitos 📋

- Python 3.8+
- discord.py 2.6.4
- xlsxwriter (para exportación a Excel)

## Uso 💻

Una vez que el bot esté en tu servidor Discord:

```
!diag a:50 b:30 c:20 d:100
```

El bot te responderá con un análisis completo incluyendo:
- Tabla 2x2 formateada
- Sensibilidad y Especificidad
- VPP y VPN
- RR, OR con IC 95%
- LR+ y LR-
- Interpretación epidemiológica
- Opción de descargar en Excel

## Autor 👨‍💻

Desarrollado con amor (y un poco de caos) para la comunidad epidemiológica.

## Licencia 📄

MIT License - Úsalo, modifícalo, comparte tu versión mejorada.
