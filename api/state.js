// /api/state — persistencia del panel Lathos en Supabase.
// GET  /api/state          -> devuelve el DB completo {version, roster, periods:[...]}
// POST /api/state  (body=DB)-> upserta cada mes (lathos_periods) y el roster (lathos_meta)
//
// Variables de entorno necesarias en Vercel:
//   SUPABASE_URL                 -> https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    -> service_role key (Settings > API). NO la anon. Es secreta.
//
// Las tablas (ya creadas):
//   lathos_periods(month text pk, label text, data jsonb, updated_at timestamptz)
//   lathos_meta(id text pk, roster jsonb, version int, updated_at timestamptz)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sb(path, init) {
  return fetch(SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/' + path, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json',
      ...(init && init.headers),
    },
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body !== undefined && req.body !== null) { resolve(req.body); return; }
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => resolve(d));
    req.on('error', () => resolve(''));
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.status(500).json({ error: 'Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Vercel' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const [pr, mr] = await Promise.all([
        sb('lathos_periods?select=month,label,data&order=month.asc'),
        sb('lathos_meta?id=eq.main&select=roster,version'),
      ]);
      if (!pr.ok) throw new Error('GET periods ' + pr.status + ' ' + (await pr.text()));
      if (!mr.ok) throw new Error('GET meta ' + mr.status + ' ' + (await mr.text()));
      const periods = await pr.json();
      const meta = (await mr.json())[0] || { roster: { set: [], cold: [] }, version: 5 };
      const DB = {
        version: meta.version || 5,
        roster: meta.roster || { set: [], cold: [] },
        periods: (periods || []).map((row) =>
          Object.assign({ id: 'p_' + row.month, label: row.label }, row.data || {})
        ),
      };
      res.status(200).json(DB);
      return;
    }

    if (req.method === 'POST') {
      let body = await readBody(req);
      if (typeof body === 'string') body = JSON.parse(body || '{}');
      if (!body || !Array.isArray(body.periods)) {
        res.status(400).json({ error: 'payload inválido (falta periods[])' });
        return;
      }
      const now = new Date().toISOString();
      const rows = body.periods.map((p) => {
        const month = String(p.id || '').replace(/^p_/, '');
        return {
          month,
          label: p.label || month,
          data: {
            set:  p.set  || {},
            cold: p.cold || {},
            vsl:  p.vsl  || {},
            vslt: p.vslt || {},
            crea: p.crea || {},
            added: p.added,
          },
          updated_at: now,
        };
      });
      const up = await sb('lathos_periods?on_conflict=month', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows),
      });
      if (!up.ok) throw new Error('upsert periods ' + up.status + ' ' + (await up.text()));

      const mt = await sb('lathos_meta?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{
          id: 'main',
          roster: body.roster || { set: [], cold: [] },
          version: body.version || 5,
          updated_at: now,
        }]),
      });
      if (!mt.ok) throw new Error('upsert meta ' + mt.status + ' ' + (await mt.text()));

      res.status(200).json({ ok: true, saved: rows.length });
      return;
    }

    res.status(405).json({ error: 'método no permitido' });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
