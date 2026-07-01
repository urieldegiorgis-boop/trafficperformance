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

// Etiqueta legible de CADA estado (contable o no), verificada contra la organización Close.
// Solo se usa para el modo ?debug=1, para ver el estado real de cada lead contado.
const STATUS_LABEL = {
  stat_or2XIbsvG8ClthhoLyqfmFchIYcetvCHR8j1sZM6dIi: 'Close the Deal',
  stat_Que6zp8r2nrt5hsujY1GiOS1AvUSuXvl1Mn42acVW1n: 'Deposito',
  stat_PLFEehKTh4RpixsDl734y6ZhewczaVM2s4jbw0WqZ5w: 'Split Pay',
  stat_PvrKkDHFKwlDBT2wsLkrQCxKQxc6W5nba03ftYs8Om2: 'Follow up',
  stat_OKpqX3sp2UG3Rrj01l3JUoqFGaDw9tl9c1T90tCApE7: 'Lost / Bad Fit',
  stat_pQ2Ap6ZeDcWz7T3ZmYVXCW2ldcXf9MMVnIdDyaCMMBv: 'Cancel',
  stat_MiEXbLVcOtbTVPQv3WJnIISlGfxuwLPTzYyqt716Ltw: 'No show',
  stat_g99SPoAQUzxbKcMcJdAUhoe4W4H1T1GchIdHaMzLkLS: 'No Show VSL',
  stat_oI5dIRSQPlQ8DqkJJLzbqfVKBhhT915w73NctzINXwY: 'Nueva Reserva',
  stat_TlMZO9rIF0ixAIpSJxSTS9zIkyVoHaZkifvjXdGDSQA: 'Reagendado',
  stat_YTu3PG6vZsaWOlObraMGdB3lk12IFV5Uljm8VJyEs4C: 'Refund',
  stat_W0tolfA3oHNVHmviKFDfhDareaulX0UNDDT7hR66nY5: 'Repesca 1',
  stat_bJAtoqhmvKcxVIC77K1ipAts4gnKtTmG9oAizFRWFJf: 'Repesca 2',
  stat_7IYjMitrHNYtf8M70iXpJueL8DmW6dZ9LODvPjayh2Z: 'Repesca 3',
  stat_8ORBBSGJkqI763tEjhFY5xUoCjoosIU7YkbT50N7Mvl: 'Oferta #1',
  stat_a4qtbHOoMfJw60wENbaCwjxBBWdxe9ouoAFkjkOQiCn: 'Reactivación',
  stat_BeHjpPBQOhP7EnfTEEXfH6bUrBZv3d2YbZDAFh9WdPr: 'Repesca Cold calling',
  stat_SFFdfrzx3bCWqXmHVvEGJW9UnIvT02jZEXwY2q7i9yO: 'Nuevo Optin',
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

  // --- Modo diagnóstico: ?debug=1 devuelve la lista plana de leads contados ---
  const DEBUG = req.query.debug === '1' || req.query.debug === 'true';
  const dbg = { total_leads_devueltos: 0, no_contables: 0, contados: 0, leads: [] };
  // Anti-duplicados: nunca contar el mismo lead dos veces dentro del mismo segmento.
  const seen = { set:{}, cold:{}, vsl:{}, vslt:{}, crea:{} };
  const once = (seg, key, id) => {
    if (!key) key = '(sin nombrar)';
    const s = (seen[seg][key] || (seen[seg][key] = new Set()));
    if (s.has(id)) return false; // ya contado en este segmento
    s.add(id); return true;
  };

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
        if (DEBUG) dbg.total_leads_devueltos++;
        const bucket = STATUS[lead.status_id];
        if (!bucket) { if (DEBUG) dbg.no_contables++; continue; } // estado no contable (Nuevo Optin, etc.)
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

        if (setter && once('set', setter, lead.id)) { bump(out.set, setter, bucket); pushDet(det.set, setter, rec); }
        if (cold   && once('cold', cold, lead.id))  { bump(out.cold, cold, bucket);  pushDet(det.cold, cold, rec); }
        if (!setter && !cold && source === 'vsl' && once('vsl', term, lead.id)) { bump(out.vsl, term, bucket); pushDet(det.vsl, term, rec); } // VSL puro
        if (source === 'vsl' && once('vslt', term, lead.id)) { bump(out.vslt, term, bucket); pushDet(det.vslt, term, rec); }                   // VSL Total
        if (once('crea', term, lead.id)) { bump(out.crea, term, bucket); pushDet(det.crea, term, rec); }                                       // Creativos (todas las fuentes)

        if (DEBUG) {
          dbg.contados++;
          dbg.leads.push({
            lead: lead.display_name || '(sin nombre)',
            call_date: getCustom(lead, F.callDate) || '(vacío)',
            estado: STATUS_LABEL[lead.status_id] || lead.status_id,
            setter: setter || '—',
            cold_caller: cold || '—',
            source: source || '—',
            creativo: term || '—',
          });
        }
      }
      cursor = json.cursor;
    } while (cursor && ++guard < 60); // hasta ~12.000 leads/mes

    // no-store: cada "↻ Sincronizar" consulta Close EN VIVO (sin caché de Vercel).
    // Antes: s-maxage=120 -> podía devolver el estado viejo del lead tras re-sincronizar.
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    if (DEBUG) {
      // En debug ordenamos los leads por call date para leerlos fácil.
      dbg.leads.sort((a, b) => String(a.call_date).localeCompare(String(b.call_date)));
      return res.status(200).json({ from: start, to: end, ...out, det, _debug: dbg });
    }
    return res.status(200).json({ from: start, to: end, ...out, det });
  } catch (e) {
    return res.status(500).json({ error: 'Fallo al consultar Close', detail: String(e).slice(0, 500) });
  }
};
