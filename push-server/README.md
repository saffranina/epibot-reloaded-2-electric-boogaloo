# Foco · servidor de notificaciones

Pequeño Worker de Cloudflare que envía la notificación de "¡Pomodoro terminado!" al
iPhone aunque la pantalla esté bloqueada (Web Push). Solo guarda la próxima alarma de
cada dispositivo y la borra al enviarla.

- `GET /vapid`: clave pública para suscribirse a las notificaciones.
- `POST /schedule`: `{ id, subscription, at, title, body }` programa el aviso (una alarma por dispositivo).
- `POST /cancel`: `{ id }` cancela el aviso (al pausar o reiniciar).
- `POST /test`: envía una notificación de inmediato.

Usa un Durable Object por dispositivo con una alarma; las claves VAPID se generan solas
la primera vez. Todo cabe en el plan gratuito de Cloudflare.

## Publicación

El workflow `.github/workflows/push-server-deploy.yml` lo publica cuando cambia esta carpeta
en `main`. Necesita dos secretos del repositorio (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN`: token con la plantilla "Edit Cloudflare Workers".
- `CLOUDFLARE_ACCOUNT_ID`: el ID de la cuenta (aparece en el panel de Workers & Pages).

Después, la dirección del Worker va en `PUSH_URL` al inicio de `pomodoro/app.js`.

## Probar en local

```bash
npx wrangler dev
```
