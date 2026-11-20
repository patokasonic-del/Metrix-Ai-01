const PASS_DURATION_MS = 24 * 60 * 60 * 1000;
const INTASEND_STATUS_URL = 'https://api.intasend.com/api/v1/payment/status/';

async function supabaseRequest(path, options = {}) {
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
    Prefer: 'return=representation',
    ...(options.headers || {}),
  };

  if (!serviceKey.startsWith('sb_secret_')) {
    headers.Authorization = `Bearer ${serviceKey}`;
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Supabase error (${response.status})`);
  }
  return data;
}

async function checkIntaSendPaymentStatus({ invoiceId, checkoutId }) {
  const secretKey = (
    process.env.INTASEND_SECRET_KEY ||
    process.env.INTASEND_PRIVATE_KEY ||
    ''
  ).trim();

  if (!secretKey) {
    throw new Error(
      'Server configuration error: INTASEND_SECRET_KEY is missing in Vercel environment variables.'
    );
  }

  const payload = {};
  if (invoiceId) payload.invoice_id = invoiceId;
  if (checkoutId) payload.checkout_id = checkoutId;

  const response = await fetch(INTASEND_STATUS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const msg =
      data?.detail ||
      data?.message ||
      data?.error ||
      `IntaSend status check failed (${response.status}).`;
    throw new Error(msg);
  }

  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const email = String(body?.email || '').trim().toLowerCase();
    const incomingCheckoutId = String(
      body?.checkoutRequestId || body?.checkout_id || ''
    ).trim();
    const invoiceId = String(body?.invoiceId || body?.invoice_id || '').trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid student email is required to verify payment.' });
    }

    // Look up student row in Supabase so we can fall back to their saved last_checkout_id
    const rows = await supabaseRequest(
      `students?email=eq.${encodeURIComponent(email)}&select=*`
    );
    const student = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

    if (!student) {
      return res.status(404).json({ error: 'Student account not found in Supabase.' });
    }

    const checkoutId = incomingCheckoutId || String(student.last_checkout_id || '').trim();

    if (!invoiceId && !checkoutId) {
      return res.status(400).json({
        error: 'No IntaSend checkout or invoice reference found. Send the 10 KES prompt first.',
      });
    }

    const statusData = await checkIntaSendPaymentStatus({ invoiceId, checkoutId });
    const invoiceObj =
      statusData?.invoice && typeof statusData.invoice === 'object'
        ? statusData.invoice
        : statusData;

    const state = String(invoiceObj?.state || statusData?.state || '').trim().toUpperCase();
    const resolvedId = String(
      invoiceObj?.invoice_id || statusData?.invoice_id || checkoutId || invoiceId || ''
    ).trim();

    if (state !== 'COMPLETE') {
      const reason =
        invoiceObj?.failed_reason ||
        statusData?.failed_reason ||
        `Current payment status is ${state || 'PENDING'}.`;
      return res.status(400).json({
        paid: false,
        state: state || 'PENDING',
        error: `Payment not completed yet (${reason}). Complete the 10 KES prompt and try again.`,
      });
    }

    const passExpiresAt = Date.now() + PASS_DURATION_MS;
    const passExpiresAtIso = new Date(passExpiresAt).toISOString();

    await supabaseRequest(
      `students?email=eq.${encodeURIComponent(email)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          pass_expires_at: passExpiresAtIso,
          last_checkout_id: resolvedId || checkoutId || null,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    return res.status(200).json({
      paid: true,
      state: 'COMPLETE',
      passExpiresAt,
      checkoutRequestId: resolvedId || checkoutId || '',
    });
  } catch (error) {
    console.error('Matrix AI /api/verify-payment error:', error);
    return res.status(500).json({
      paid: false,
      error: error?.message || 'Failed to verify IntaSend payment.',
    });
  }
}
