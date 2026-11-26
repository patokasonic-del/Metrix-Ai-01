const FREE_QUESTION_LIMIT = 10;

async function supabaseRequest(path) {
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      'Server configuration error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in Vercel.'
    );
  }

  const headers = {
    apikey: serviceKey,
    'Content-Type': 'application/json',
  };

  if (!serviceKey.startsWith('sb_secret_')) {
    headers.Authorization = `Bearer ${serviceKey}`;
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method: 'GET',
    headers,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Supabase error (${response.status})`);
  }

  return Array.isArray(data) ? data : [];
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  try {
    const configuredKey = (process.env.ADMIN_STATS_KEY || '').trim();
    const providedKey = String(
      req.headers['x-admin-key'] || req.query?.key || ''
    ).trim();

    if (configuredKey && providedKey !== configuredKey) {
      return res.status(401).json({ error: 'Unauthorized: invalid admin stats key.' });
    }

    const rows = await supabaseRequest(
      'students?select=email,selected_unit,questions_used,pass_expires_at,device_id,created_at&order=created_at.desc'
    );

    const nowMs = Date.now();
    const unitCounts = new Map();
    const deviceIds = new Set();

    let activePasses = 0;
    let hitFreeLimit = 0;
    let totalQuestionsUsed = 0;

    for (const row of rows) {
      const qUsed = Number(row.questions_used || 0);
      totalQuestionsUsed += qUsed;

      const expMs = row.pass_expires_at ? new Date(row.pass_expires_at).getTime() : 0;
      const hasActivePass = Number.isFinite(expMs) && expMs > nowMs;
      if (hasActivePass) {
        activePasses += 1;
      } else if (qUsed >= FREE_QUESTION_LIMIT) {
        hitFreeLimit += 1;
      }

      if (row.device_id) {
        deviceIds.add(String(row.device_id).trim());
      }

      const unitLabel = String(row.selected_unit || '').trim() || 'Not selected yet';
      unitCounts.set(unitLabel, (unitCounts.get(unitLabel) || 0) + 1);
    }

    const topUnits = Array.from(unitCounts.entries())
      .map(([unit, count]) => ({ unit, count }))
      .sort((a, b) => b.count - a.count);

    const recentStudents = rows.slice(0, 20).map((row) => {
      const expMs = row.pass_expires_at ? new Date(row.pass_expires_at).getTime() : 0;
      return {
        email: row.email,
        selectedUnit: row.selected_unit || 'Not selected yet',
        questionsUsed: Number(row.questions_used || 0),
        hasActivePass: Number.isFinite(expMs) && expMs > nowMs,
        createdAt: row.created_at || null,
      };
    });

    return res.status(200).json({
      totalStudents: rows.length,
      activePasses,
      hitFreeLimit,
      uniqueDevices: deviceIds.size,
      totalQuestionsUsed,
      topUnits,
      recentStudents,
    });
  } catch (error) {
    console.error('Matrix AI /api/stats error:', error);
    return res.status(500).json({
      error: error?.message || 'Failed to load student stats.',
    });
  }
}
