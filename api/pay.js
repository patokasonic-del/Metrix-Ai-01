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
  if (env === 'sandbox') {
    return 'https://sandbox.intasend.com';
  }
  return 'https://api.intasend.com';
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

    // Optional demo fallback when INTASEND_DEMO_MODE=true or INTASEND_SECRET_KEY is not set yet
    if (demoMode || !secretKey) {
      return res.status(200).json({
        checkoutRequestId: `demo_inv_${crypto.randomBytes(6).toString('hex')}`,
        phone,
        email,
        amount: 10,
        message:
          '10 KES IntaSend STK Push prepared (Demo Mode). Click "I Have Paid — Verify Payment" to activate your 24-hour pass.',
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

    const checkoutId =
      data?.invoice?.invoice_id ||
      data?.id ||
      apiRef;

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
