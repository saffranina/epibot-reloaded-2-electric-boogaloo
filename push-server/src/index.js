// Foco · servidor de notificaciones.
// La app avisa cuándo termina el temporizador; un Durable Object por dispositivo guarda
// ese momento con una alarma y, al llegar, envía la notificación por Web Push.

import { DurableObject } from 'cloudflare:workers';
import { generateVapidKeys, sendPush, vapidPublicKey } from './webpush.js';

const SUBJECT = 'https://saffranina.github.io/epibot-reloaded-2-electric-boogaloo/';
const MAX_AHEAD_MS = 4 * 60 * 60 * 1000; // nada más allá de 4 horas
// Solo servicios de push reales: el servidor no debe poder usarse para llamar a cualquier URL.
const PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

export class Timer extends DurableObject {
  // Claves VAPID: se crean una sola vez y viven en el objeto "__vapid__".
  async keys() {
    let keys = await this.ctx.storage.get('vapid');
    if (!keys) {
      keys = await generateVapidKeys();
      await this.ctx.storage.put('vapid', keys);
    }
    return keys;
  }

  async schedule(job) {
    await this.ctx.storage.put('job', job);
    await this.ctx.storage.setAlarm(job.at);
  }

  async cancel() {
    await this.ctx.storage.delete('job');
    await this.ctx.storage.deleteAlarm();
  }

  async alarm() {
    const job = await this.ctx.storage.get('job');
    if (!job) return;
    const status = await deliver(this.env, job.subscription, job.message);
    // Si el servicio de push falla, lanzar hace que Cloudflare reintente la alarma.
    if (status >= 500) throw new Error(`push ${status}`);
    await this.ctx.storage.delete('job');
  }
}

async function deliver(env, subscription, message) {
  const keys = await env.TIMER.get(env.TIMER.idFromName('__vapid__')).keys();
  return sendPush(subscription, message, keys, SUBJECT);
}

function validSubscription(sub, env) {
  try {
    const url = new URL(sub.endpoint);
    const hostOk = PUSH_HOSTS.some((re) => re.test(url.hostname))
      || (env.TEST_PUSH_ORIGIN && url.origin === env.TEST_PUSH_ORIGIN); // solo para pruebas locales
    return (url.protocol === 'https:' || (env.TEST_PUSH_ORIGIN && url.origin === env.TEST_PUSH_ORIGIN))
      && hostOk
      && typeof sub.keys?.p256dh === 'string' && sub.keys.p256dh.length >= 80 && sub.keys.p256dh.length <= 100
      && typeof sub.keys?.auth === 'string' && sub.keys.auth.length >= 16 && sub.keys.auth.length <= 32;
  } catch {
    return false;
  }
}

const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const json = (data, status = 200) => new Response(JSON.stringify(data), {
      status, headers: { ...cors, 'Content-Type': 'application/json' },
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const { pathname } = new URL(request.url);

    if (request.method === 'GET' && pathname === '/vapid') {
      const keys = await env.TIMER.get(env.TIMER.idFromName('__vapid__')).keys();
      return json({ publicKey: vapidPublicKey(keys.publicJwk) });
    }
    if (request.method === 'GET' && pathname === '/') return json({ ok: true, app: 'Foco' });
    if (request.method !== 'POST') return json({ error: 'not found' }, 404);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
    if (!validId(body.id)) return json({ error: 'bad id' }, 400);
    const timer = env.TIMER.get(env.TIMER.idFromName(`device:${body.id}`));

    if (pathname === '/cancel') {
      await timer.cancel();
      return json({ ok: true });
    }

    if (!validSubscription(body.subscription || {}, env)) return json({ error: 'bad subscription' }, 400);
    const subscription = { endpoint: body.subscription.endpoint, keys: body.subscription.keys };
    const message = { title: text(body.title, 80) || 'Foco', body: text(body.body, 160) };

    if (pathname === '/schedule') {
      const at = Number(body.at);
      if (!Number.isFinite(at) || at < Date.now() - 5000 || at > Date.now() + MAX_AHEAD_MS) {
        return json({ error: 'bad time' }, 400);
      }
      await timer.schedule({ at, subscription, message });
      return json({ ok: true });
    }

    if (pathname === '/test') {
      const status = await deliver(env, subscription, message);
      return json({ ok: status < 300, status }, status < 300 ? 200 : 502);
    }

    return json({ error: 'not found' }, 404);
  },
};
