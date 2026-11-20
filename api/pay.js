import crypto from 'node:crypto';

function normalizeKenyanPhone(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}

function getIntaSendBaseUrl() {
  const env = (process.env.INTASEND_ENV || '').trim().toLowerCase();
  return env === 'sandbox' ? 'https://sandbox.intasend.com' : 'https://api.intasend.com';
}

async function saveTransactionToSupabase(record) {
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !serviceRoleKey) return;

  const res = await fetch(`${supabaseUrl}/rest/v1/transactions`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(record),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('Supabase insert transaction error:', res.status, errText);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const phone = normalizeKenyanPhone(body?.phone);
    const email = String(body?.email || '').trim().toLowerCase();

    if (!phone) {
      return res.status(400).json({
        error: 'Invalid M-Pesa phone number. Use format 07XXXXXXXX or 2547XXXXXXXX.',
      });
    }

    const secretKey = (process.env.INTASEND_SECRET_KEY || '').trim();
    const demoMode = (process.env.INTASEND_DEMO_MODE || '').trim().toLowerCase() === 'true';

    // Demo fallback when INTASEND_DEMO_MODE=true or INTASEND_SECRET_KEY is not set
    if (demoMode || !secretKey) {
      const demoId = `demo_inv_${crypto.randomBytes(6).toString('hex')}`;
      await saveTransactionToSupabase({
        checkout_request_id: demoId,
        student_email: email || null,
        phone,
        amount: 10,
        status: 'PENDING',
      });

      return res.status(200).json({
        checkoutRequestId: demoId,
        phone,
        email,
        amount: 10,
        message:
          '10 KES STK Push prepared (Demo Mode). Click "I Have Paid — Verify Payment" to activate your 24-hour pass.',
      });
    }

    const baseUrl = getIntaSendBaseUrl();
    const apiRef = `metrix-24h-${Date.now()}`;

    const payload = {
      amount: 10,
      phone_number: phone,
      api_ref: apiRef,
    };
    if (email) {
      payload.email = email;
    }

    const response = await fetch(`${baseUrl}/api/v1/payment/mpesa-stk-push/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          data?.errors?.[0]?.detail ||
          data?.detail ||
          data?.message ||
          'Failed to send the 10 KES M-Pesa STK Push via IntaSend.',
      });
    }

    const checkoutId = data?.invoice?.invoice_id || data?.id || apiRef;

    // Record pending transaction in Supabase
    await saveTransactionToSupabase({
      checkout_request_id: checkoutId,
      student_email: email || null,
      phone,
      amount: 10,
      status: 'PENDING',
    });

    return res.status(200).json({
      checkoutRequestId: checkoutId,
      invoiceId: data?.invoice?.invoice_id || null,
      apiRef,
      phone,
      email,
      amount: 10,
      message:
        'A 10 KES M-Pesa STK Push prompt has been sent to your phone via IntaSend. Enter your PIN, then click "I Have Paid — Verify Payment".',
    });
  } catch (error) {
    console.error('Metrix AI 01 IntaSend /api/pay error:', error);
    return res.status(500).json({
      error: error?.message || 'Unexpected error while initiating 10 KES payment with IntaSend.',
    });
  }
}
