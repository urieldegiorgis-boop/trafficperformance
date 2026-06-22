// api/close.js — Función serverless (Vercel) para el Panel de Rendimiento Lathos.
// Devuelve, para un mes (por Call Date), cuatro segmentos listos para el dashboard:
//   set  = leads por Setter        (campo Setter no vacío)        × estado
//   cold = leads por Cold Caller   (campo Cold Caller no vacío)   × estado
//   vsl  = leads con Source=vsl Y SIN setter Y SIN cold caller, por creativo (UTM term) × estado  (VSL puro)
//   vslt = leads con Source=vsl (todos: puros + trabajados por setter/cold), por creativo × estado (VSL Total)
//   crea = leads por creativo (UTM term), TODAS las fuentes       × estado
// Además, devuelve `det`: la LISTA de leads (nombre, email/teléfono, estado, call date, enlace)
// por cada clave de cada segmento, para poder desplegarla al pulsar un nombre en el panel.
// Se ignoran estados que no son de llamada (Nuevo Optin, Repesca, Oferta #1, Refund...).
//
// Requiere la variable de entorno CLOSE_API_KEY (Settings → Environment Variables en Vercel).
// Uso: GET /api/close?from=2026-06-16&to=2026-06-23  (rango; 'to' exclusivo)
//      GET /api/close?month=2026-06                  (mes completo, compatibilidad)

const CLOSE_API = 'https://api.close.com/api/v1/data/search/';

// --- IDs de campos personalizados (de tu organización Close) ---
const F = {
  callDate:   'cf_CM9afjVZyJq2qmxiDXc2z1NKXAnJRX2txG22PEfRUpm',
  setter:     'cf_9n0iOonyBP5G0Gd3S7gkBr2ezEMG2fCjkjONxfb702c',
  coldCaller: 'cf_54TcS4Fugnvz5YGFDBZwjHUpl0fdJB2uWoS9X3c94Yw',
  utmTerm:    'cf_vZjU69bVxJh5se4GdYDO31SYE4iTxkW59EkZb3KbHJg',
  source:     'cf_hetGkmtrkZPVyxtPFOcpOlLWfBqjeS4TFdcy5O8RGR1',
};

// --- Estados → cubeta del dashboard. Lo que no esté aquí (Nuevo Optin, Repesca,
//     Oferta #1, Refund, etc.) NO se cuenta. ---
const STATUS = {
  stat_or2XIbsvG8ClthhoLyqfmFchIYcetvCHR8j1sZM6dIi: 'ctd',    // Close the Deal
  stat_Que6zp8r2nrt5hsujY1GiOS1AvUSuXvl1Mn42acVW1n: 'depo',   // Depósito
  stat_PLFEehKTh4RpixsDl734y6ZhewczaVM2s4jbw0WqZ5w: 'split',  // Split Pay
  stat_PvrKkDHFKwlDBT2wsLkrQCxKQxc6W5nba03ftYs8Om2: 'fu',     // Follow up
  stat_OKpqX3sp2UG3Rrj01l3JUoqFGaDw9tl9c1T90tCApE7: 'lost',   // Lost / Bad Fit
  stat_pQ2Ap6ZeDcWz7T3ZmYVXCW2ldcXf9MMVnIdDyaCMMBv: 'cancel', // Cancel
  stat_MiEXbLVcOtbTVPQv3WJnIISlGfxuwLPTzYyqt716Ltw: 'noshow', // No show
  stat_g99SPoAQUzxbKcMcJdAUhoe4W4H1T1GchIdHaMzLkLS: 'noshow', // No Show VSL
  stat_oI5dIRSQPlQ8DqkJJLzbqfVKBhhT915w73NctzINXwY: 'nr',     // Nueva Reserva
  stat_TlMZO9rIF0ixAIpSJxSTS9zIkyVoHaZkifvjXdGDSQA: 'reag',   // Reagendado
};

const blank = () => ({ ctd:0, depo:0, split:0, fu:0, lost:0, cancel:0, noshow:0, nr:0, reag:0 });
function bump(map, key, bucket) {
  if (!key) key = '(sin nombrar)';
  if (!map[key]) map[key] = blank();
  map[key][bucket] += 1;
}
// Empuja un registro de lead (detalle) en la lista de esa clave.
function pushDet(map, key, rec) {
  if (!key) key = '(sin nombrar)';
  if (!map[key]) map[key] = [];
  map[key].push(rec);
}
function getCustom(lead, id) {
  // Close devuelve los custom como "custom.cf_xxx" (o anidados en "custom").
  const v = lead['custom.' + id] ?? (lead.custom && lead.custom[id]);
  if (v == null) return '';
  return Array.isArray(v) ? String(v[0] ?? '') : String(v);
}
// Saca el primer email y el primer teléfono de los contactos del lead.
// Muchos leads son de WhatsApp y NO tienen email: en ese caso email queda vacío
// y el panel mostrará el teléfono como alternativa.
function leadEmailPhone(lead) {
  let email = '', phone = '';
  const cs = Array.isArray(lead.contacts) ? lead.contacts : [];
  for (const c of cs) {
    if (!email && Array.isArray(c.emails) && c.emails.length) email = c.emails[0].email || '';
    if (!phone && Array.isArray(c.phones) && c.phones.length) phone = c.phones[0].phone || '';
    if (email && phone) break;
  }
  return { email, phone };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const apiKey = process.env.CLOSE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Falta CLOSE_API_KEY en las variables de entorno.' });

  // Rango de fechas (Call Date). Dos formas:
  //   ?from=YYYY-MM-DD&to=YYYY-MM-DD   (to exclusivo)  -> rango arbitrario (semana, custom)
  //   ?month=YYYY-MM                                    -> mes completo (compatibilidad)
  // Por defecto, el mes actual.
  let start, end;
  if (req.query.from && req.query.to) {
    start = req.query.from;
    end = req.query.to;
  } else {
    const month = (req.query.month || new Date().toISOString().slice(0, 7));
    const [y, m] = month.split('-').map(Number);
    start = `${y}-${String(m).padStart(2, '0')}-01`;
    end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  }

  // Query: leads con Call Date dentro del rango.
  const query = {
    type: 'and',
    queries: [
      { type: 'object_type', object_type: 'lead' },
      {
        type: 'field_condition',
        field: { type: 'custom_field', custom_field_id: F.callDate },
        condition: {
          type: 'moment_range',
          on_or_after: { type: 'fixed_local_date', value: start, which: 'start' },
          before:      { type: 'fixed_local_date', value: end,   which: 'start' },
        },
      },
    ],
  };

  const authHeader = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');
  const out = { set:{}, cold:{}, vsl:{}, vslt:{}, crea:{} };
  const det = { set:{}, cold:{}, vsl:{}, vslt:{}, crea:{} };
  let cursor = null, guard = 0;

  try {
    do {
      const body = {
        query,
        // display_name = nombre del lead; contacts = para sacar email/teléfono.
        _fields: { lead: ['id', 'display_name', 'status_id', 'custom', 'contacts'] },
        _limit: 200,
      };
      if (cursor) body.cursor = cursor;

      const r = await fetch(CLOSE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const txt = await r.text();
        return res.status(r.status).json({ error: 'Close API error', detail: txt.slice(0, 500) });
      }
      const json = await r.json();
      for (const lead of (json.data || [])) {
        const bucket = STATUS[lead.status_id];
        if (!bucket) continue; // estado no contable (Nuevo Optin, etc.)
        const setter = getCustom(lead, F.setter).trim();
        const cold   = getCustom(lead, F.coldCaller).trim();
        const term   = getCustom(lead, F.utmTerm).trim();
        const source = getCustom(lead, F.source).trim().toLowerCase();

        // Registro de detalle para este lead (mismo lead puede ir a varios segmentos).
        const { email, phone } = leadEmailPhone(lead);
        const rec = {
          n: lead.display_name || '(sin nombre)',
          e: email,
          p: phone,
          st: bucket,
          dt: getCustom(lead, F.callDate) || '',
          url: 'https://app.close.com/lead/' + lead.id + '/',
        };

        if (setter) { bump(out.set, setter, bucket); pushDet(det.set, setter, rec); }
        if (cold)   { bump(out.cold, cold, bucket);  pushDet(det.cold, cold, rec); }
        if (!setter && !cold && source === 'vsl') { bump(out.vsl, term, bucket); pushDet(det.vsl, term, rec); } // VSL puro
        if (source === 'vsl') { bump(out.vslt, term, bucket); pushDet(det.vslt, term, rec); }                   // VSL Total
        bump(out.crea, term, bucket); pushDet(det.crea, term, rec);                                             // Creativos (todas las fuentes)
      }
      cursor = json.cursor;
    } while (cursor && ++guard < 60); // hasta ~12.000 leads/mes

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
    return res.status(200).json({ from: start, to: end, ...out, det });
  } catch (e) {
    return res.status(500).json({ error: 'Fallo al consultar Close', detail: String(e).slice(0, 500) });
  }
};
