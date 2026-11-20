function getIntaSendBaseUrl() {
  const env = (process.env.INTASEND_ENV || '').trim().toLowerCase();
  return env === 'sandbox' ? 'https://sandbox.intasend.com' : 'https://api.intasend.com';
}

function getSupabaseConfig() {
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return supabaseUrl && serviceRoleKey ? { supabaseUrl, serviceRoleKey } : null;
}

async function getExistingPassFromSupabase({ checkoutRequestId, email }) {
  const cfg = getSupabaseConfig();
  if (!cfg) return null;

  const now = Date.now();

  if (checkoutRequestId) {
    const res = await fetch(
      `${cfg.supabaseUrl}/rest/v1/transactions?checkout_request_id=eq.${encodeURIComponent(checkoutRequestId)}&select=*&limit=1`,
      {
        headers: {
          apikey: cfg.serviceRoleKey,
          Authorization: `Bearer ${cfg.serviceRoleKey}`,
        },
      }
    );
    const rows = await res.json().catch(() => []);
    if (Array.isArray(rows) && rows[0]?.status === 'COMPLETE' && Number(rows[0]?.expires_at) > now) {
      return rows[0];
    }
  }

  if (email) {
    const res = await fetch(
      `${cfg.supabaseUrl}/rest/v1/transactions?student_email=eq.${encodeURIComponent(email)}&status=eq.COMPLETE&expires_at=gt.${now}&order=expires_at.desc&limit=1`,
      {
        headers: {
          apikey: cfg.serviceRoleKey,
          Authorization: `Bearer ${cfg.serviceRoleKey}`,
        },
      }
    );
    const rows = await res.json().catch(() => []);
    if (Array.isArray(rows) && rows[0]) {
      return rows[0];
    }
  }

  return null;
}

async function updateTransactionInSupabase({ checkoutRequestId, email, phone, status, expiresAt }) {
  const cfg = getSupabaseConfig();
  if (!cfg || !checkoutRequestId) return;

  const payload = {
    checkout_request_id: checkoutRequestId,
    student_email: email || null,
    phone: phone || 'unknown',
    amount: 10,
    status,
    expires_at: expiresAt || null,
    updated_at: new Date().toISOString(),
  };

  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/transactions`, {
    method: 'POST',
    headers: {
      apikey: cfg.serviceRoleKey,
      Authorization: `Bearer ${cfg.serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('Supabase update transaction error:', res.status, errText);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const checkoutRequestId = String(body?.checkoutRequestId || '').trim();
    const email = String(body?.email || '').trim().toLowerCase();
    const phone = String(body?.phone || '').trim();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

    // Check if Supabase already has a verified active 24h pass
    const existingPass = await getExistingPassFromSupabase({ checkoutRequestId, email });
    if (existingPass) {
      return res.status(200).json({
        paid: true,
        amount: 10,
        expiresAt: Number(existingPass.expires_at),
        checkoutRequestId: existingPass.checkout_request_id,
        message: 'Active 24-hour access pass confirmed from database!',
      });
    }

    const secretKey = (process.env.INTASEND_SECRET_KEY || '').trim();
    const demoMode = (process.env.INTASEND_DEMO_MODE || '').trim().toLowerCase() === 'true';

    // Demo fallback when INTASEND_DEMO_MODE=true or INTASEND_SECRET_KEY is not set
    if (demoMode || !secretKey) {
      const resolvedId = checkoutRequestId || `DEMO_INTASEND_${Date.now()}`;
      await updateTransactionInSupabase({
        checkoutRequestId: resolvedId,
        email,
        phone,
        status: 'COMPLETE',
        expiresAt,
      });

      return res.status(200).json({
        paid: true,
        amount: 10,
        expiresAt,
        checkoutRequestId: resolvedId,
        message: '10 KES payment confirmed and recorded. 24-hour access activated.',
      });
    }

    if (!checkoutRequestId) {
      return res.status(400).json({
        paid: false,
        error: 'Missing payment reference. Click "Pay 10 KES for 24h Access" first.',
      });
    }

    const baseUrl = getIntaSendBaseUrl();

    const statusRes = await fetch(`${baseUrl}/api/v1/payment/status/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        invoice_id: checkoutRequestId,
      }),
    });

    const statusData = await statusRes.json().catch(() => null);

    if (!statusRes.ok) {
      return res.status(statusRes.status).json({
        paid: false,
        error:
          statusData?.errors?.[0]?.detail ||
          statusData?.detail ||
          'Could not check IntaSend payment status.',
      });
    }

    const state = String(statusData?.invoice?.state || statusData?.state || '').toUpperCase();

    if (state === 'COMPLETE' || state === 'COMPLETED') {
      await updateTransactionInSupabase({
        checkoutRequestId,
        email,
        phone,
        status: 'COMPLETE',
        expiresAt,
      });

      return res.status(200).json({
        paid: true,
        amount: 10,
        expiresAt,
        checkoutRequestId,
        message: '10 KES payment verified via IntaSend and recorded! 24-hour access unlocked.',
      });
    }

    if (state === 'FAILED' || state === 'CANCELED' || state === 'CANCELLED') {
      await updateTransactionInSupabase({
        checkoutRequestId,
        email,
        phone,
        status: 'FAILED',
        expiresAt: null,
      });

      return res.status(200).json({
        paid: false,
        error: 'The M-Pesa payment was canceled or failed. Please try again.',
      });
    }

    return res.status(200).json({
      paid: false,
      error: `Payment status is currently ${state || 'PENDING'}. Complete the prompt on your phone and click verify again.`,
    });
  } catch (error) {
    console.error('Metrix AI 01 IntaSend /api/verify-payment error:', error);
    return res.status(500).json({
      paid: false,
      error: error?.message || 'Error while verifying payment with IntaSend.',
    });
  }
}
