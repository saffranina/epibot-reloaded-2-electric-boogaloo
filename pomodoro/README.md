# Foco · Pomodoro 🍅

Temporizador pomodoro instalable en el teléfono (PWA). No necesita Mac ni App Store.

## Funciones

- Enfoque / pausa corta / pausa larga (25 / 5 / 15 min, configurable)
- Pausa larga automática cada N pomodoros
- Campo "¿En qué vas a trabajar?" e historial de los pomodoros de hoy
- Sonido al terminar, pantalla encendida mientras corre y notificaciones (donde el sistema lo permita)
- Funciona sin conexión una vez instalada
- El tiempo se calcula con la hora de fin, así que sigue siendo correcto si sales de la app

## Instalar en iPhone

1. Abre la URL de la app en **Safari** (`https://saffranina.github.io/epibot-reloaded-2-electric-boogaloo/`).
2. Toca **Compartir** → **Agregar a pantalla de inicio**.
3. Ábrela desde el ícono: se ve como una app normal, a pantalla completa.

> Nota: iOS congela las apps web en segundo plano, así que no pueden sonar con la
> pantalla bloqueada. Lo más fiable es dejar la app abierta (mantiene la pantalla
> encendida mientras corre). Si sales y vuelves, el temporizador se pone al día solo.

## Publicación

El workflow `.github/workflows/pomodoro-pages.yml` publica la carpeta `pomodoro/`
en GitHub Pages cada vez que cambia en `main`. Solo hay que activarlo una vez:
**Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Probar localmente

```bash
cd pomodoro
python3 -m http.server 8000
# abre http://localhost:8000
```
