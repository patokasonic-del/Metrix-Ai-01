const INTASEND_STK_PUSH_URL = 'https://api.intasend.com/api/v1/payment/mpesa-stk-push/';
const PAYMENT_AMOUNT_KES = 10;

async function supabaseRequest(path, options = {}) {
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl || !serviceKey) {
    return null;
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

function normalizePhone(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^0[17]\d{8}$/.test(digits)) return '254' + digits.slice(1);
  if (/^[17]\d{8}$/.test(digits)) return '254' + digits;
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const secretKey = (
    process.env.INTASEND_SECRET_KEY ||
    process.env.INTASEND_PRIVATE_KEY ||
    ''
  ).trim();

  if (!secretKey) {
    return res.status(500).json({
      error:
        'Server configuration error: INTASEND_SECRET_KEY is missing in Vercel environment variables.',
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const phone = normalizePhone(body?.phone);
    const email = String(body?.email || '').trim().toLowerCase();
    const selectedUnit = String(body?.selectedUnit || 'General Studies').trim();

    if (!phone) {
      return res.status(400).json({
        error: 'Please enter a valid Kenyan M-Pesa phone number (e.g., 07XXXXXXXX or 2547XXXXXXXX).',
      });
    }

    const intasendPayload = {
      amount: PAYMENT_AMOUNT_KES,
      phone_number: phone,
      currency: 'KES',
      email: email || undefined,
      api_ref: `metrix_24h_${email || phone}_${Date.now()}`,
      narrative: `Matrix AI 24-Hour Pass (${selectedUnit})`,
    };

    const response = await fetch(INTASEND_STK_PUSH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(intasendPayload),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const errMsg =
        data?.detail ||
        data?.message ||
        data?.error ||
        `IntaSend STK push failed (${response.status}).`;
      return res.status(response.status >= 400 && response.status < 600 ? response.status : 502).json({
        error: errMsg,
      });
    }

    const invoiceObj =
      data?.invoice && typeof data.invoice === 'object' ? data.invoice : null;

    const checkoutRequestId = String(
      invoiceObj?.invoice_id ||
        data?.id ||
        data?.checkout_id ||
        data?.invoice_id ||
        ''
    ).trim();

    if (email && checkoutRequestId) {
      await supabaseRequest(
        `students?email=eq.${encodeURIComponent(email)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            last_checkout_id: checkoutRequestId,
            updated_at: new Date().toISOString(),
          }),
        }
      ).catch(() => null);
    }

    return res.status(200).json({
      ok: true,
      checkoutRequestId,
      message:
        '10 KES M-Pesa prompt sent to your phone. Enter your M-Pesa PIN, then click "I Have Paid — Verify Payment".',
    });
  } catch (error) {
    console.error('Matrix AI /api/pay error:', error);
    return res.status(500).json({
      error: error?.message || 'Could not initiate the 10 KES payment prompt.',
    });
  }
}
