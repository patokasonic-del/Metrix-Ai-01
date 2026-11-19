import crypto from 'node:crypto';

function normalizeKenyanPhone(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}

function getDarajaTimestamp() {
  const now = new Date();
  const eastAfricaTime = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${eastAfricaTime.getUTCFullYear()}` +
    `${pad(eastAfricaTime.getUTCMonth() + 1)}` +
    `${pad(eastAfricaTime.getUTCDate())}` +
    `${pad(eastAfricaTime.getUTCHours())}` +
    `${pad(eastAfricaTime.getUTCMinutes())}` +
    `${pad(eastAfricaTime.getUTCSeconds())}`
  );
}

function getDarajaBaseUrl() {
  return (process.env.MPESA_ENV || 'sandbox').trim().toLowerCase() === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

async function getDarajaAccessToken(baseUrl, consumerKey, consumerSecret) {
  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const tokenRes = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${credentials}`,
    },
  });

  const tokenData = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok || !tokenData?.access_token) {
    throw new Error(tokenData?.error_description || 'Failed to get M-Pesa access token.');
  }
  return tokenData.access_token;
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

    const demoMode = (process.env.MPESA_DEMO_MODE || '').trim().toLowerCase() === 'true';
    const consumerKey = (process.env.MPESA_CONSUMER_KEY || '').trim();
    const consumerSecret = (process.env.MPESA_CONSUMER_SECRET || '').trim();
    const shortcode = (process.env.MPESA_SHORTCODE || '').trim();
    const passkey = (process.env.MPESA_PASSKEY || '').trim();
    const callbackUrl = (process.env.MPESA_CALLBACK_URL || '').trim();

    // Allow smooth testing on Vercel when MPESA_DEMO_MODE=true or Daraja keys aren't set yet
    if (demoMode || !consumerKey || !consumerSecret || !shortcode || !passkey) {
      const mockCheckoutId = `ws_CO_DEMO_${crypto.randomBytes(6).toString('hex')}`;
      return res.status(200).json({
        checkoutRequestId: mockCheckoutId,
        phone,
        email,
        amount: 10,
        message:
          '10 KES STK Push request prepared (Demo Mode). Click "I Have Paid — Verify Payment" to activate your 24-hour access pass.',
      });
    }

    const baseUrl = getDarajaBaseUrl();
    const accessToken = await getDarajaAccessToken(baseUrl, consumerKey, consumerSecret);
    const timestamp = getDarajaTimestamp();
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
    const resolvedCallbackUrl =
      callbackUrl ||
      (req.headers.host ? `https://${req.headers.host}/api/verify-payment` : 'https://example.com/api/verify-payment');

    const stkRes = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: 10,
        PartyA: phone,
        PartyB: shortcode,
        PhoneNumber: phone,
        CallBackURL: resolvedCallbackUrl,
        AccountReference: 'MetrixAI01',
        TransactionDesc: 'Metrix AI 01 24h Access (10 KES)',
      }),
    });

    const stkData = await stkRes.json().catch(() => null);
    if (!stkRes.ok || stkData?.ResponseCode !== '0') {
      return res.status(400).json({
        error:
          stkData?.errorMessage ||
          stkData?.ResponseDescription ||
          'Failed to send the 10 KES M-Pesa STK Push prompt.',
      });
    }

    return res.status(200).json({
      checkoutRequestId: stkData.CheckoutRequestID,
      merchantRequestId: stkData.MerchantRequestID,
      phone,
      email,
      amount: 10,
      message:
        'A 10 KES M-Pesa prompt has been sent to your phone. Enter your M-Pesa PIN, then click "I Have Paid — Verify Payment".',
    });
  } catch (error) {
    console.error('Metrix AI 01 /api/pay error:', error);
    return res.status(500).json({
      error: error?.message || 'Unexpected error while initiating the 10 KES payment.',
    });
  }
}
