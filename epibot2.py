# epibot_reloaded_electric_boogaloo.py
# Bot de Discord de epidemiologia con:
# - Tabla 2x2
# - Sens, espec, VPP, VPN, IC 95 %
# - RR, OR e IC 95 %
# - LR+, LR-, Bayes post test
# - Interpretaciones chistosas
# - Insultos suaves
# - ASCII y "CSS" decorativo (mentira, solo estilo)
# - Embeds bien coloridos
# - Comando !bayes para calculos rapidos
# - Comando !meta para explicaciones teoricas
# - Comando !lastdiag para ver tu ultimo analisis
# - Comando !insultoepi para apoyo emocional agresivo
# - Slash command /diagquick
# - Exportar resultados a Excel (.xlsx) en !diag (un solo mensaje)

import discord
from discord.ext import commands
from discord import app_commands
import math
import asyncio
import random
from datetime import datetime
import io
import os

# Intentamos importar xlsxwriter para generar Excel
try:
    import xlsxwriter
    HAS_XLSX = True
except ImportError:
    HAS_XLSX = False

# ===========================
# CONFIGURACION DEL BOT ⚙️
# ===========================

intents = discord.Intents.default()
intents.message_content = True  # Necesario para leer mensajes

bot = commands.Bot(command_prefix="!", intents=intents)

ASCII_BANNER = r"""
╔═══════════════════════════════════╗
║   EPIBOT RELOADED ⚡              ║
║       ELECTRIC BOOGALOO          ║
╚═══════════════════════════════════╝
"""

def get_random_color():
    colores = [
        discord.Color.blue(),
        discord.Color.red(),
        discord.Color.green(),
        discord.Color.orange(),
        discord.Color.purple(),
        discord.Color.teal(),
        discord.Color.gold(),
        discord.Color.magenta(),
    ]
    return random.choice(colores)

# Guardar ultimo resultado por usuario
LAST_RESULTS = {}  # user_id -> dict con resumen

# ===========================
# UTILIDADES ESTADISTICAS 🧮
# ===========================

def proportion_ci_wilson(x, n, z=1.96):
    """
    Intervalo de confianza de Wilson para una proporcion.
    x = exitos
    n = total
    z = valor z (1.96 para 95 %)
    Devuelve (p, lower, upper)
    """
    if n == 0:
        return (float('nan'), float('nan'), float('nan'))
    p = x / n
    denom = 1 + (z**2) / n
    center = (p + (z**2) / (2*n)) / denom
    half_width = (z * math.sqrt(p*(1-p)/n + (z**2)/(4*n**2))) / denom
    return p, max(0, center - half_width), min(1, center + half_width)

def fmt_pct(x):
    if math.isnan(x):
        return "NA"
    return f"{x*100:.1f}%"

def safe_div(a, b):
    if b == 0:
        return float('nan')
    return a / b

def odds_to_prob(odds):
    if odds <= 0:
        return float('nan')
    return odds / (1 + odds)

def compute_rr_or(a, b, c, d, z=1.96):
    """
    Calcula RR y OR con IC 95 % usando tabla:
      a b
      c d
    Fila 1 = expuestos, Fila 2 = no expuestos.
    Aplica correccion de continuidad si hay ceros.
    Devuelve:
      risk1, risk0, rr, rr_l, rr_u, or_p, or_l, or_u
    """
    # Correccion de continuidad si hay ceros
    if min(a, b, c, d) == 0:
        a = a + 0.5
        b = b + 0.5
        c = c + 0.5
        d = d + 0.5

    # Riesgos
    risk1 = safe_div(a, a + b)
    risk0 = safe_div(c, c + d)

    # Riesgo relativo
    rr = safe_div(risk1, risk0)
    if rr <= 0 or math.isnan(rr):
        rr_l = rr_u = float('nan')
    else:
        ln_rr = math.log(rr)
        se_ln_rr = math.sqrt(
            safe_div(1, a) - safe_div(1, a + b) +
            safe_div(1, c) - safe_div(1, c + d)
        )
        if math.isnan(se_ln_rr) or se_ln_rr == 0:
            rr_l = rr_u = float('nan')
        else:
            rr_l = math.exp(ln_rr - z * se_ln_rr)
            rr_u = math.exp(ln_rr + z * se_ln_rr)

    # Odds ratio
    or_p = safe_div(a * d, b * c)
    if or_p <= 0 or math.isnan(or_p):
        or_l = or_u = float('nan')
    else:
        ln_or = math.log(or_p)
        se_ln_or = math.sqrt(
            safe_div(1, a) + safe_div(1, b) +
            safe_div(1, c) + safe_div(1, d)
        )
        if math.isnan(se_ln_or) or se_ln_or == 0:
            or_l = or_u = float('nan')
        else:
            or_l = math.exp(ln_or - z * se_ln_or)
            or_u = math.exp(ln_or + z * se_ln_or)

    return risk1, risk0, rr, rr_l, rr_u, or_p, or_l, or_u

# ===========================
# CHISTES E INSULTOS 🤡
# ===========================

EPI_CHISTES = [
    "Esto es cultura general, por favor. 📚",
    "El gold standard eres tu, pero en procrastinar. ⏰",
    "Si te sabes esto, te dejo copiar en el parcial de epi. 📝",
    "Recuerda: sin tabla 2x2 no hay paraiso. 2️⃣✖️2️⃣",
    "No confundas sensibilidad con ser sensible, por favor. 😭",
    "La verdadera pandemia es la falta de lectura del Gordis. 📖",
    "Bayes no es un pokemon, es una forma de sufrir con estilo. 🔍",
]

INSULTOS_SUAVES = [
    "Mi amor, eso no suma ni con calculadora. 🧮",
    "Esa cuenta esta peor que un Excel del ministerio. 📉",
    "Revisa los numeros, futuro caso de estudio. 🧟",
    "Ni el SPSS se atreveria a aceptar esos datos. 💻",
    "Eso esta mas roto que el sistema de salud. 🏥",
]

CIERRES_INTERP = [
    "Mensaje final: respira, toma agua y revisa la muestra. 💧",
    "Moraleja: el problema no es Bayes, es el mundo real. 🌎",
    "Conclusion cientifica: depende. Como siempre. 🤡",
    "Recomendacion oficial: no presentes esto sin revisar dos veces. 🔁",
    "Diagnostico del bot: necesitas cafe y tal vez vacaciones. ☕✈️",
]

def random_chiste():
    return random.choice(EPI_CHISTES)

def random_insulto():
    return random.choice(INSULTOS_SUAVES)

def random_cierre():
    return random.choice(CIERRES_INTERP)

# ===========================
# INTERPRETACION DE RESULTADOS 🧠
# ===========================

def interpretar_resultados(
    sens_p,
    spec_p,
    ppv_p,
    npv_p,
    lr_pos,
    lr_neg,
    prevalence,
    post_prob_pos,
    post_prob_neg
):
    """
    Genera una interpretacion chistosa de las metricas.
    """
    lineas = []

    # Sensibilidad
    if not math.isnan(sens_p):
        if sens_p >= 0.9:
            lineas.append("Sensibilidad alta: buen test para descartar enfermedad si sale negativo. Regla pero no confirma. ✅")
        elif sens_p >= 0.7:
            lineas.append("Sensibilidad moderada: sirve para orientar, pero no te cases con un negativo. 🧭")
        else:
            lineas.append("Sensibilidad baja: con negativos yo no dormiria tranquilo. 😬")

    # Especificidad
    if not math.isnan(spec_p):
        if spec_p >= 0.9:
            lineas.append("Especificidad alta: si sale positivo, probablemente algo serio hay. Sirve para confirmar. 🚨")
        elif spec_p >= 0.7:
            lineas.append("Especificidad moderada: un positivo da pistas, pero pide apoyo de otro test o del clinico con criterio. 🩺")
        else:
            lineas.append("Especificidad baja: te regala positivos como si fueran stickers. 🎟️")

    # VPP y VPN
    if not math.isnan(ppv_p):
        if ppv_p >= 0.8:
            lineas.append("VPP alto: un test positivo casi siempre significa enfermo. Bien ahi. 🔥")
        elif ppv_p <= 0.5:
            lineas.append("VPP bajito: muchos falsos positivos. Mas que test, parece horoscopo. 🔮")
    if not math.isnan(npv_p):
        if npv_p >= 0.9:
            lineas.append("VPN alto: un resultado negativo tranquiliza bastante. 😌")
        elif npv_p <= 0.7:
            lineas.append("VPN bajo: un negativo no descarta gran cosa. No te confies. ⚠️")

    # Prevalencia
    if not math.isnan(prevalence):
        if prevalence < 0.1:
            lineas.append("Prevalencia baja: cuidado con los falsos positivos, el VPP sufre en poblaciones sanas. 🏃")
        elif prevalence > 0.5:
            lineas.append("Prevalencia alta: aqui casi todo el mundo esta enfermo, el VPN puede caer facilmente. 😷")

    # Likelihood ratios
    if not math.isnan(lr_pos):
        if lr_pos >= 10:
            lineas.append("LR+ muy alto: un positivo cambia fuerte la probabilidad. Este test no vino a jugar. 💣")
        elif lr_pos >= 5:
            lineas.append("LR+ moderado: positivo que suma bastante, aunque no es oraculo. 📈")
        elif lr_pos >= 2:
            lineas.append("LR+ debil: aporta, pero no da vuelta la historia. 📊")
        else:
            lineas.append("LR+ casi inutil: el test positivo no cambia mucho la pelicula. 🍿")

    if not math.isnan(lr_neg):
        if lr_neg <= 0.1:
            lineas.append("LR- muy bajo: un negativo es bastante tranquilizador. 🧊")
        elif lr_neg <= 0.2:
            lineas.append("LR- moderado: un negativo baja bien la probabilidad, pero no tanto como uno quisiera. 📉")
        elif lr_neg <= 0.5:
            lineas.append("LR- flojito: baja un poco la probabilidad, pero no alcanza para confiar ciegamente. 😕")
        else:
            lineas.append("LR- mediocre: un negativo casi no cambia nada. Muy triste. 😢")

    # Post test probabilities
    if not math.isnan(post_prob_pos):
        if post_prob_pos >= 0.9:
            lineas.append("P(enfermedad | test positivo) muy alta: el positivo casi sella el destino. Confirma y actua. ⚔️")
        elif post_prob_pos >= 0.7:
            lineas.append("P(enfermedad | test positivo) alta: hay que tomar el positivo en serio, aunque puedes pedir otra opinion. 🧠")
        elif post_prob_pos <= 0.3:
            lineas.append("P(enfermedad | test positivo) baja: test positivo que casi no significa nada. Problemas de VPP, tal vez prevalencia baja. 🤨")
    if not math.isnan(post_prob_neg):
        if post_prob_neg <= 0.1:
            lineas.append("P(enfermedad | test negativo) muy baja: negativo que casi descarta la enfermedad. Hermoso cuando pasa. 🌈")
        elif post_prob_neg >= 0.4:
            lineas.append("P(enfermedad | test negativo) algo alta: incluso con test negativo, la probabilidad no baja mucho. No te dejes engañar por el papelito. 🧾")

    if not lineas:
        lineas.append("No puedo decir mucho, los datos estan raros o incompletos. Haz de cuenta que esto es un articulo mal hecho. 📉")

    lineas.append(random_cierre())

    return "\n".join(f"- {l}" for l in lineas)

# ===========================
# INTERACCION PASO A PASO 🧱
# ===========================

async def ask_number(ctx, label, help_text):
    """
    Pregunta un numero al usuario.
    Respuestas validas: entero >= 0 o 'skip'.
    Devuelve (valor o None, cancel=True/False).
    """
    extra = ""
    if random.random() < 0.4:
        extra = "\n" + random_chiste()

    await ctx.send(
        f"**{label}** ({help_text})\n"
        f"Escribe un numero entero >= 0 o `skip` si no lo sabes.{extra}"
    )

    def check(m):
        return m.author == ctx.author and m.channel == ctx.channel

    while True:
        try:
            msg = await bot.wait_for("message", check=check, timeout=120)
        except asyncio.TimeoutError:
            await ctx.send("⏰ Tiempo agotado. Se cancelo el calculo. Estudia para el proximo intento.")
            return None, True

        content = msg.content.strip().lower()

        if content in ("skip", "na", "ns", "no se", "nose"):
            return None, False

        try:
            val = int(content)
            if val < 0:
                await ctx.send("Numero negativo no. Todavia no estamos simulando apocalipsis. 💣")
                continue
            return val, False
        except ValueError:
            await ctx.send("No entendi. Escribe un numero entero o `skip`. No es tan dificil. 🙃")

def infer_missing(data):
    """
    Intenta inferir VP, FN, FP, VN usando:
    VP + FN = total_enfermos
    FP + VN = total_sanos
    Rellena lo que pueda. Devuelve False si detecta incoherencias.
    """
    changed = True
    while changed:
        changed = False
        tp = data["tp"]
        fn = data["fn"]
        fp = data["fp"]
        tn = data["tn"]
        diseased = data["diseased"]
        non_diseased = data["non_diseased"]

        # Ecuacion 1: tp + fn = diseased
        if diseased is not None:
            if tp is not None and fn is None:
                data["fn"] = diseased - tp
                changed = True
            elif fn is not None and tp is None:
                data["tp"] = diseased - fn
                changed = True
            elif tp is not None and fn is not None:
                if diseased != tp + fn:
                    return False
        elif diseased is None and tp is not None and fn is not None:
            data["diseased"] = tp + fn
            changed = True

        # Ecuacion 2: fp + tn = non_diseased
        if non_diseased is not None:
            if fp is not None and tn is None:
                data["tn"] = non_diseased - fp
                changed = True
            elif tn is not None and fp is None:
                data["fp"] = non_diseased - tn
                changed = True
            elif fp is not None and tn is not None:
                if non_diseased != fp + tn:
                    return False
        elif non_diseased is None and fp is not None and tn is not None:
            data["non_diseased"] = fp + tn
            changed = True

    for key in ["tp", "fn", "fp", "tn", "diseased", "non_diseased"]:
        if data[key] is not None and data[key] < 0:
            return False

    return True

# ===========================
# EVENTOS 🔔
# ===========================

@bot.event
async def on_ready():
    print(f"Bot conectado como {bot.user}")
    try:
        await bot.tree.sync()
        print("Slash commands sincronizados.")
    except Exception as e:
        print(f"Error sincronizando slash commands: {e}")

# ===========================
# COMANDO PRINCIPAL !diag 📊
# ===========================

@bot.command(name="diag")
async def diag(ctx):
    """
    Wizard interactivo:
    Pregunta VP, FN, FP, VN, total enfermos y total sanos.
    Acepta 'skip' y trata de inferir lo que falte.
    Incluye chistes, insultos suaves, Bayes, RR y OR.
    Exporta resultados a Excel si hay xlsxwriter (en el mismo mensaje).
    """
    embed_intro = discord.Embed(
        title="EPIBOT RELOADED ⚡ ELECTRIC BOOGALOO",
        description=f"```ascii\n{ASCII_BANNER}\n```",
        color=get_random_color()
    )
    embed_intro.add_field(
        name="Modo diagnostico 🧪",
        value="Vamos a hacer la tabla 2x2. No te preocupes, solo voy a juzgarte un poco. 😈",
        inline=False
    )
    await ctx.send(embed=embed_intro)

    data = {
        "tp": None,
        "fn": None,
        "fp": None,
        "tn": None,
        "diseased": None,
        "non_diseased": None,
    }

    # Preguntas
    data["tp"], cancel = await ask_number(ctx, "VP (TP)", "verdaderos positivos ✅")
    if cancel:
        return

    data["fn"], cancel = await ask_number(ctx, "FN", "falsos negativos ❌")
    if cancel:
        return

    data["fp"], cancel = await ask_number(ctx, "FP", "falsos positivos ⚠️")
    if cancel:
        return

    data["tn"], cancel = await ask_number(ctx, "VN (TN)", "verdaderos negativos 🧊")
    if cancel:
        return

    data["diseased"], cancel = await ask_number(
        ctx,
        "Total enfermos",
        "segun el gold standard (VP + FN) 🦠"
    )
    if cancel:
        return

    data["non_diseased"], cancel = await ask_number(
        ctx,
        "Total sanos",
        "segun el gold standard (FP + VN) 😇"
    )
    if cancel:
        return

    # Intentar inferir lo que falte
    ok = infer_missing(data)
    if not ok:
        embed_err = discord.Embed(
            title="Datos incoherentes 😵",
            description=f"{random_insulto()}",
            color=discord.Color.red()
        )
        embed_err.add_field(
            name="Sugerencia",
            value="Revisa las sumas VP+FN y FP+VN. Algo no esta cerrando. 🔍",
            inline=False
        )
        await ctx.send(embed=embed_err)
        return

    tp = data["tp"]
    fn = data["fn"]
    fp = data["fp"]
    tn = data["tn"]

    if None in (tp, fn, fp, tn):
        faltan = [k.upper() for k, v in [("tp", tp), ("fn", fn), ("fp", fp), ("tn", tn)] if v is None]
        embed_faltan = discord.Embed(
            title="Faltan datos ⛔",
            description=f"No se pudo completar la tabla 2x2.\nFaltan: {', '.join(faltan)}.",
            color=discord.Color.orange()
        )
        embed_faltan.add_field(
            name="Comentario del bot",
            value=random_insulto(),
            inline=False
        )
        await ctx.send(embed=embed_faltan)
        return

    diseased = data["diseased"] if data["diseased"] is not None else tp + fn
    non_diseased = data["non_diseased"] if data["non_diseased"] is not None else fp + tn
    total = diseased + non_diseased

    # Metricas clasicas
    sens_p, sens_l, sens_u = proportion_ci_wilson(tp, diseased)
    spec_p, spec_l, spec_u = proportion_ci_wilson(tn, non_diseased)
    ppv_p, ppv_l, ppv_u = proportion_ci_wilson(tp, tp + fp)
    npv_p, npv_l, npv_u = proportion_ci_wilson(tn, tn + fn)

    # Bayes y LR
    prevalence = safe_div(diseased, total)

    if math.isnan(prevalence) or prevalence <= 0 or prevalence >= 1:
        pretest_odds = float('nan')
    else:
        pretest_odds = prevalence / (1 - prevalence)

    lr_pos = safe_div(sens_p, 1 - spec_p)
    lr_neg = safe_div(1 - sens_p, spec_p)

    if not math.isnan(pretest_odds) and not math.isnan(lr_pos) and lr_pos > 0:
        post_odds_pos = pretest_odds * lr_pos
        post_prob_pos = odds_to_prob(post_odds_pos)
    else:
        post_prob_pos = float('nan')

    if not math.isnan(pretest_odds) and not math.isnan(lr_neg) and lr_neg > 0:
        post_odds_neg = pretest_odds * lr_neg
        post_prob_neg = odds_to_prob(post_odds_neg)
    else:
        post_prob_neg = float('nan')

    # RR y OR (tratando filas como expuestos/no expuestos)
    risk1, risk0, rr, rr_l, rr_u, or_p, or_l, or_u = compute_rr_or(tp, fp, fn, tn)

    interpretacion = interpretar_resultados(
        sens_p,
        spec_p,
        ppv_p,
        npv_p,
        lr_pos,
        lr_neg,
        prevalence,
        post_prob_pos,
        post_prob_neg
    )

    # Guardar en historial del usuario
    LAST_RESULTS[ctx.author.id] = {
        "tp": tp,
        "fn": fn,
        "fp": fp,
        "tn": tn,
        "diseased": diseased,
        "non_diseased": non_diseased,
        "total": total,
        "sens_p": sens_p,
        "spec_p": spec_p,
        "ppv_p": ppv_p,
        "npv_p": npv_p,
        "prevalence": prevalence,
        "lr_pos": lr_pos,
        "lr_neg": lr_neg,
        "post_prob_pos": post_prob_pos,
        "post_prob_neg": post_prob_neg,
        "risk1": risk1,
        "risk0": risk0,
        "rr": rr,
        "rr_l": rr_l,
        "rr_u": rr_u,
        "or_p": or_p,
        "or_l": or_l,
        "or_u": or_u,
        "interpretacion": interpretacion,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }

    # ===========================
    # ARMAR EMBED DE RESULTADOS
    # ===========================

    embed_res = discord.Embed(
        title="Resultados diagnosticos 📊",
        description="EPIBOT RELOADED: Electric Boogaloo",
        color=get_random_color()
    )

    tabla_txt = (
        f"                Enfermo      Sano\n"
        f"Test positivo    {tp:5d}      {fp:5d}\n"
        f"Test negativo    {fn:5d}      {tn:5d}\n"
        f"\n"
        f"Total enfermos = {diseased}\n"
        f"Total sanos    = {non_diseased}\n"
        f"Total          = {total}\n"
    )

    embed_res.add_field(
        name="Tabla 2x2 (gold standard) 🧱",
        value=f"```text\n{tabla_txt}```",
        inline=False
    )

    metricas_txt = (
        f"Sensibilidad: {fmt_pct(sens_p)} (IC 95 % {fmt_pct(sens_l)} a {fmt_pct(sens_u)})\n"
        f"Especificidad: {fmt_pct(spec_p)} (IC 95 % {fmt_pct(spec_l)} a {fmt_pct(spec_u)})\n"
        f"VPP (PPV): {fmt_pct(ppv_p)} (IC 95 % {fmt_pct(ppv_l)} a {fmt_pct(ppv_u)})\n"
        f"VPN (NPV): {fmt_pct(npv_p)} (IC 95 % {fmt_pct(npv_l)} a {fmt_pct(npv_u)})\n"
    )

    embed_res.add_field(
        name="Metricas diagnosticas 🧪",
        value=f"```text\n{metricas_txt}```",
        inline=False
    )

    bayes_txt = (
        f"Prevalencia (pre test): {fmt_pct(prevalence)}\n"
        f"LR+: {lr_pos:.3f}   LR-: {lr_neg:.3f}\n"
        f"P(enfermedad | test positivo): {fmt_pct(post_prob_pos)}\n"
        f"P(enfermedad | test negativo): {fmt_pct(post_prob_neg)}\n"
    )

    embed_res.add_field(
        name="Bayes para gente cansada 😴",
        value=f"```text\n{bayes_txt}```",
        inline=False
    )

    rr_or_txt = (
        f"Riesgo fila 1 (expuestos): {fmt_pct(risk1)}\n"
        f"Riesgo fila 2 (no expuestos): {fmt_pct(risk0)}\n"
        f"RR: {rr:.3f} (IC 95 % {rr_l:.3f} a {rr_u:.3f})\n"
        f"OR: {or_p:.3f} (IC 95 % {or_l:.3f} a {or_u:.3f})\n"
    )

    embed_res.add_field(
        name="Medidas de asociacion ⚖️",
        value=f"```text\n{rr_or_txt}```",
        inline=False
    )

    embed_res.add_field(
        name="Interpretacion orientativa 🧠",
        value=interpretacion,
        inline=False
    )

    # ===========================
    # ENVIAR UN SOLO MENSAJE (CON O SIN EXCEL)
    # ===========================

    if HAS_XLSX:
        output = io.BytesIO()
        workbook = xlsxwriter.Workbook(output, {'in_memory': True})
        ws = workbook.add_worksheet("EpiBot")

        row = 0
        ws.write(row, 0, "EPIBOT RELOADED: Electric Boogaloo")
        row += 2

        ws.write(row, 0, "Tabla 2x2")
        row += 1
        ws.write_row(row, 0, ["", "Enfermo", "Sano"])
        row += 1
        ws.write_row(row, 0, ["Test positivo", tp, fp])
        row += 1
        ws.write_row(row, 0, ["Test negativo", fn, tn])
        row += 2

        ws.write(row, 0, "Metricas diagnosticas")
        row += 1
        ws.write_row(row, 0, ["Sensibilidad", fmt_pct(sens_p), f"IC 95 % {fmt_pct(sens_l)} a {fmt_pct(sens_u)}"])
        row += 1
        ws.write_row(row, 0, ["Especificidad", fmt_pct(spec_p), f"IC 95 % {fmt_pct(spec_l)} a {fmt_pct(spec_u)}"])
        row += 1
        ws.write_row(row, 0, ["VPP", fmt_pct(ppv_p), f"IC 95 % {fmt_pct(ppv_l)} a {fmt_pct(ppv_u)}"])
        row += 1
        ws.write_row(row, 0, ["VPN", fmt_pct(npv_p), f"IC 95 % {fmt_pct(npv_l)} a {fmt_pct(npv_u)}"])
        row += 2

        ws.write(row, 0, "Bayes")
        row += 1
        ws.write_row(row, 0, ["Prevalencia", fmt_pct(prevalence)])
        row += 1
        ws.write_row(row, 0, ["LR+", f"{lr_pos:.3f}"])
        row += 1
        ws.write_row(row, 0, ["LR-", f"{lr_neg:.3f}"])
        row += 1
        ws.write_row(row, 0, ["P(enfermedad | +)", fmt_pct(post_prob_pos)])
        row += 1
        ws.write_row(row, 0, ["P(enfermedad | -)", fmt_pct(post_prob_neg)])
        row += 2

        ws.write(row, 0, "Medidas de asociacion (filas = expuestos/no expuestos)")
        row += 1
        ws.write_row(row, 0, ["Riesgo fila 1", fmt_pct(risk1)])
        row += 1
        ws.write_row(row, 0, ["Riesgo fila 2", fmt_pct(risk0)])
        row += 1
        ws.write_row(row, 0, ["RR", f"{rr:.3f}", f"IC 95 % {rr_l:.3f} a {rr_u:.3f}"])
        row += 1
        ws.write_row(row, 0, ["OR", f"{or_p:.3f}", f"IC 95 % {or_l:.3f} a {or_u:.3f}"])
        row += 2

        ws.write(row, 0, "Interpretacion")
        row += 1
        for line in interpretacion.split("\n"):
            ws.write(row, 0, line)
            row += 1

        workbook.close()
        output.seek(0)
        excel_file = discord.File(fp=output, filename="epibot_diag.xlsx")

        embed_res.set_footer(text=random_chiste() + " Ademas te adjunto un Excel. 📂")
        await ctx.send(
            content="Aqui tienes tu resumen y tu Excel epidemiologico, mi siela. 💅",
            embed=embed_res,
            file=excel_file
        )
    else:
        embed_res.set_footer(text=random_chiste() + " (Instala xlsxwriter para exportar a Excel). 🧩")
        await ctx.send(embed=embed_res)

# ===========================
# COMANDO !bayes (rapido) 🎯
# ===========================

@bot.command(name="bayes")
async def bayes_cmd(ctx, sens: float, espec: float, prevalencia: float):
    """
    Calcula LR+, LR-, probabilidades post test a partir de:
    !bayes sens espec prevalencia
    Los valores pueden ir en % (ej 90) o en proporcion (0.9).
    """
    def norm(x):
        # Si parece porcentaje (>1), lo paso a proporcion
        if x > 1:
            return x / 100.0
        return x

    sens_p = norm(sens)
    spec_p = norm(espec)
    prev_p = norm(prevalencia)

    prevalence = prev_p
    if math.isnan(prevalence) or prevalence <= 0 or prevalence >= 1:
        pretest_odds = float('nan')
    else:
        pretest_odds = prevalence / (1 - prevalence)

    lr_pos = safe_div(sens_p, 1 - spec_p)
    lr_neg = safe_div(1 - sens_p, spec_p)

    if not math.isnan(pretest_odds) and not math.isnan(lr_pos) and lr_pos > 0:
        post_odds_pos = pretest_odds * lr_pos
        post_prob_pos = odds_to_prob(post_odds_pos)
    else:
        post_prob_pos = float('nan')

    if not math.isnan(pretest_odds) and not math.isnan(lr_neg) and lr_neg > 0:
        post_odds_neg = pretest_odds * lr_neg
        post_prob_neg = odds_to_prob(post_odds_neg)
    else:
        post_prob_neg = float('nan')

    embed = discord.Embed(
        title="Bayes en modo rapido 🎯",
        description="A partir de sensibilidad, especificidad y prevalencia.",
        color=get_random_color()
    )

    entrada_txt = (
        f"Sensibilidad: {fmt_pct(sens_p)}\n"
        f"Especificidad: {fmt_pct(spec_p)}\n"
        f"Prevalencia (pre test): {fmt_pct(prevalence)}\n"
    )

    salida_txt = (
        f"LR+: {lr_pos:.3f}\n"
        f"LR-: {lr_neg:.3f}\n"
        f"P(enfermedad | test positivo): {fmt_pct(post_prob_pos)}\n"
        f"P(enfermedad | test negativo): {fmt_pct(post_prob_neg)}\n"
    )

    embed.add_field(name="Parametros de entrada 📥", value=f"```text\n{entrada_txt}```", inline=False)
    embed.add_field(name="Resultados 📤", value=f"```text\n{salida_txt}```", inline=False)
    embed.set_footer(text="Esto tambien es cultura general. " + random_chiste())

    await ctx.send(embed=embed)

# ===========================
# COMANDO !lastdiag 🕒
# ===========================

@bot.command(name="lastdiag")
async def lastdiag(ctx):
    """
    Muestra el ultimo analisis hecho por este usuario.
    """
    user_id = ctx.author.id
    data = LAST_RESULTS.get(user_id)
    if not data:
        await ctx.send("Todavia no tengo ningun analisis tuyo guardado. Usa `!diag` primero. 📊")
        return

    embed = discord.Embed(
        title="Tu ultimo analisis diagnostico 🕒",
        description=f"Guardado en: {data['timestamp']}",
        color=get_random_color()
    )

    tabla_txt = (
        f"                Enfermo      Sano\n"
        f"Test positivo    {data['tp']:5d}      {data['fp']:5d}\n"
        f"Test negativo    {data['fn']:5d}      {data['tn']:5d}\n"
        f"\n"
        f"Total enfermos = {data['diseased']}\n"
        f"Total sanos    = {data['non_diseased']}\n"
        f"Total          = {data['total']}\n"
    )

    embed.add_field(name="Tabla 2x2 🧱", value=f"```text\n{tabla_txt}```", inline=False)

    metricas_txt = (
        f"Sensibilidad: {fmt_pct(data['sens_p'])}\n"
        f"Especificidad: {fmt_pct(data['spec_p'])}\n"
        f"VPP: {fmt_pct(data['ppv_p'])}\n"
        f"VPN: {fmt_pct(data['npv_p'])}\n"
        f"Prevalencia: {fmt_pct(data['prevalence'])}\n"
        f"LR+: {data['lr_pos']:.3f}   LR-: {data['lr_neg']:.3f}\n"
        f"P(enfermedad | test +): {fmt_pct(data['post_prob_pos'])}\n"
        f"P(enfermedad | test -): {fmt_pct(data['post_prob_neg'])}\n"
        f"Riesgo fila 1: {fmt_pct(data['risk1'])}\n"
        f"Riesgo fila 2: {fmt_pct(data['risk0'])}\n"
        f"RR: {data['rr']:.3f} (IC 95 % {data['rr_l']:.3f} a {data['rr_u']:.3f})\n"
        f"OR: {data['or_p']:.3f} (IC 95 % {data['or_l']:.3f} a {data['or_u']:.3f})\n"
    )

    embed.add_field(name="Metricas 📊", value=f"```text\n{metricas_txt}```", inline=False)
    embed.add_field(name="Interpretacion 🧠", value=data["interpretacion"], inline=False)
    embed.set_footer(text="No reemplaza la clinica, pero ayuda a llorar con fundamentos. 😌")

    await ctx.send(embed=embed)

# ===========================
# COMANDO DE INSULTO SUELTO 😈
# ===========================

@bot.command(name="insultoepi")
async def insultoepi(ctx):
    """
    Lanza un insulto suave epidemiologico.
    """
    embed = discord.Embed(
        title="Diagnostico del bot 🩻",
        description=random_insulto(),
        color=discord.Color.dark_red()
    )
    await ctx.send(embed=embed)

# ===========================
# COMANDO !meta (explicacion) 📚
# ===========================

@bot.command(name="meta")
async def meta_cmd(ctx):
    """
    Explica brevemente sensibilidad, especificidad, VPP, VPN, LR, RR y OR.
    """
    embed = discord.Embed(
        title="Meta-epidemiologia para sobrevivir al parcial 📚",
        color=get_random_color()
    )

    embed.add_field(
        name="Sensibilidad 🧪",
        value="Probabilidad de que el test salga POSITIVO cuando el paciente ESTA enfermo.\nSirve para DESCARTAR cuando es alta (regla out).",
        inline=False
    )
    embed.add_field(
        name="Especificidad 🧪",
        value="Probabilidad de que el test salga NEGATIVO cuando el paciente NO esta enfermo.\nSirve para CONFIRMAR cuando es alta (rule in).",
        inline=False
    )
    embed.add_field(
        name="VPP (valor predictivo positivo) 🔍",
        value="Probabilidad de que el paciente ESTE enfermo si el test sale POSITIVO.\nDepende mucho de la prevalencia.",
        inline=False
    )
    embed.add_field(
        name="VPN (valor predictivo negativo) 🧊",
        value="Probabilidad de que el paciente NO este enfermo si el test sale NEGATIVO.\nTambien depende de la prevalencia.",
        inline=False
    )
    embed.add_field(
        name="Likelihood ratios (LR+, LR-) 🎯",
        value=(
            "LR+ = cambio en la probabilidad cuando el test es positivo.\n"
            "LR- = cambio en la probabilidad cuando el test es negativo.\n"
            "Se usan con Bayes para pasar de probabilidad pre test a post test.\n"
            "Traduccion: cuanto te deberia importar un resultado."
        ),
        inline=False
    )
    embed.add_field(
        name="RR (riesgo relativo) ⚖️",
        value=(
            "RR = riesgo en expuestos / riesgo en no expuestos.\n"
            "RR > 1 sugiere que la exposicion aumenta el riesgo.\n"
            "RR < 1 sugiere que podria ser protectora."
        ),
        inline=False
    )
    embed.add_field(
        name="OR (odds ratio) 🎲",
        value=(
            "OR = odds de evento en expuestos / odds en no expuestos.\n"
            "Muy usado en estudios de casos y controles.\n"
            "Si la enfermedad es rara, OR ≈ RR."
        ),
        inline=False
    )
    embed.set_footer(text="Esto si es cultura general. " + random_chiste())

    await ctx.send(embed=embed)

# ===========================
# COMANDO DE INSTRUCCIONES 📖
# ===========================

@bot.command(name="instrucciones")
async def instrucciones(ctx):
    """
    Explica como usar el bot.
    """
    chiste = random_chiste()

    embed = discord.Embed(
        title="EPIBOT RELOADED ⚡ ELECTRIC BOOGALOO",
        description=f"```ascii\n{ASCII_BANNER}\n```",
        color=get_random_color()
    )

    embed.add_field(
        name="Que hace este bot 🤓",
        value=(
            f"{chiste}\n\n"
            "Este bot calcula estadisticas diagnosticas y de asociacion:\n"
            "- Tabla 2x2\n"
            "- Sensibilidad y especificidad\n"
            "- VPP y VPN\n"
            "- Intervalos de confianza 95 % (Wilson)\n"
            "- Prevalencia\n"
            "- LR+ y LR-\n"
            "- Probabilidades post test con Bayes\n"
            "- RR y OR con IC 95 %\n"
            "- Interpretacion automatica y chistosa\n"
            "- Exportar resultados a Excel en !diag (si hay xlsxwriter)\n"
        ),
        inline=False
    )

    embed.add_field(
        name="Comandos principales 🧾",
        value=(
            "```text\n"
            "!diag          -> Wizard interactivo con VP, FN, FP, VN y Excel\n"
            "!bayes a b c   -> Bayes rapido con sensibilidad, especificidad, prevalencia\n"
            "!lastdiag      -> Muestra tu ultimo analisis\n"
            "!meta          -> Explica sens, espec, VPP, VPN, LR, RR, OR\n"
            "!insultoepi    -> Insulto suave de apoyo emocional\n"
            "```"
        ),
        inline=False
    )

    embed.add_field(
        name="Slash command (/diagquick) ⚡",
        value=(
            "Si invitaste al bot con el scope `applications.commands`, puedes usar:\n"
            "`/diagquick tp fn fp tn`\n"
            "Para un calculo directo sin wizard.\n"
        ),
        inline=False
    )

    embed.add_field(
        name="Tema visual 🎨",
        value=(
            "Embeds con colores aleatorios (azul, violeta, verde, etc.).\n"
            "Estilo oficial: *hotpink epidemiologico con vibes de parcial a las 7 am*."
        ),
        inline=False
    )

    embed.set_footer(text="Recordatorio: esto es apoyo didactico. No lo cites como paper indexado. 📑")

    await ctx.send(embed=embed)

# ===========================
# SLASH COMMAND /diagquick ⚡
# ===========================

@bot.tree.command(name="diagquick", description="Calculo rapido con TP, FN, FP, TN (slash command).")
@app_commands.describe(
    tp="Verdaderos positivos",
    fn="Falsos negativos",
    fp="Falsos positivos",
    tn="Verdaderos negativos"
)
async def diagquick(interaction: discord.Interaction, tp: int, fn: int, fp: int, tn: int):
    diseased = tp + fn
    non_diseased = fp + tn
    total = diseased + non_diseased

    sens_p, sens_l, sens_u = proportion_ci_wilson(tp, diseased)
    spec_p, spec_l, spec_u = proportion_ci_wilson(tn, non_diseased)
    ppv_p, ppv_l, ppv_u = proportion_ci_wilson(tp, tp + fp)
    npv_p, npv_l, npv_u = proportion_ci_wilson(tn, tn + fn)

    prevalence = safe_div(diseased, total)
    if math.isnan(prevalence) or prevalence <= 0 or prevalence >= 1:
        pretest_odds = float('nan')
    else:
        pretest_odds = prevalence / (1 - prevalence)

    lr_pos = safe_div(sens_p, 1 - spec_p)
    lr_neg = safe_div(1 - sens_p, spec_p)

    if not math.isnan(pretest_odds) and not math.isnan(lr_pos) and lr_pos > 0:
        post_odds_pos = pretest_odds * lr_pos
        post_prob_pos = odds_to_prob(post_odds_pos)
    else:
        post_prob_pos = float('nan')

    if not math.isnan(pretest_odds) and not math.isnan(lr_neg) and lr_neg > 0:
        post_odds_neg = pretest_odds * lr_neg
        post_prob_neg = odds_to_prob(post_odds_neg)
    else:
        post_prob_neg = float('nan')

    risk1, risk0, rr, rr_l, rr_u, or_p, or_l, or_u = compute_rr_or(tp, fp, fn, tn)

    embed = discord.Embed(
        title="diagquick (slash) ⚡",
        description="Calculo rapido con TP, FN, FP, TN.",
        color=get_random_color()
    )

    tabla_txt = (
        f"                Enfermo      Sano\n"
        f"Test positivo    {tp:5d}      {fp:5d}\n"
        f"Test negativo    {fn:5d}      {tn:5d}\n"
        f"\n"
        f"Total enfermos = {diseased}\n"
        f"Total sanos    = {non_diseased}\n"
        f"Total          = {total}\n"
    )

    metricas_txt = (
        f"Sensibilidad: {fmt_pct(sens_p)} (IC 95 % {fmt_pct(sens_l)} a {fmt_pct(sens_u)})\n"
        f"Especificidad: {fmt_pct(spec_p)} (IC 95 % {fmt_pct(spec_l)} a {fmt_pct(spec_u)})\n"
        f"VPP: {fmt_pct(ppv_p)} (IC 95 % {fmt_pct(ppv_l)} a {fmt_pct(ppv_u)})\n"
        f"VPN: {fmt_pct(npv_p)} (IC 95 % {fmt_pct(npv_l)} a {fmt_pct(npv_u)})\n"
        f"Prevalencia: {fmt_pct(prevalence)}\n"
        f"LR+: {lr_pos:.3f}   LR-: {lr_neg:.3f}\n"
        f"P(enfermedad | test +): {fmt_pct(post_prob_pos)}\n"
        f"P(enfermedad | test -): {fmt_pct(post_prob_neg)}\n"
        f"RR: {rr:.3f} (IC 95 % {rr_l:.3f} a {rr_u:.3f})\n"
        f"OR: {or_p:.3f} (IC 95 % {or_l:.3f} a {or_u:.3f})\n"
    )

    embed.add_field(name="Tabla 2x2 🧱", value=f"```text\n{tabla_txt}```", inline=False)
    embed.add_field(name="Metricas 📊", value=f"```text\n{metricas_txt}```", inline=False)
    embed.set_footer(text=random_chiste())

    await interaction.response.send_message(embed=embed)

# ===========================
# ARRANQUE DEL BOT 🚀
# ===========================

token = os.getenv("DISCORD_TOKEN")
if not token:
    raise ValueError("DISCORD_TOKEN environment variable not set!")
bot.run(token)
