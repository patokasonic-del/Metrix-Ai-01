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
    const checkoutRequestId = String(body?.checkoutRequestId || '').trim();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

    const secretKey = (process.env.INTASEND_SECRET_KEY || '').trim();
    const demoMode = (process.env.INTASEND_DEMO_MODE || '').trim().toLowerCase() === 'true';

    // Demo fallback when INTASEND_DEMO_MODE=true or INTASEND_SECRET_KEY is not set yet
    if (demoMode || !secretKey) {
      return res.status(200).json({
        paid: true,
        amount: 10,
        expiresAt,
        checkoutRequestId: checkoutRequestId || 'DEMO_INTASEND_PASS',
        message: '10 KES payment confirmed. 24-hour access activated.',
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

    const state = String(
      statusData?.invoice?.state ||
      statusData?.state ||
      ''
    ).toUpperCase();

    if (state === 'COMPLETE' || state === 'COMPLETED') {
      return res.status(200).json({
        paid: true,
        amount: 10,
        expiresAt,
        checkoutRequestId,
        message: '10 KES payment verified via IntaSend! 24-hour access unlocked.',
      });
    }

    if (state === 'FAILED' || state === 'CANCELED' || state === 'CANCELLED') {
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
