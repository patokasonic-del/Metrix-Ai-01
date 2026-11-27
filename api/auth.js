import crypto from 'node:crypto';

const DAILY_TIME_ZONE = 'Africa/Nairobi';

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'tempmail.com',
  'temp-mail.org',
  '10minutemail.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'yopmail.com',
  'trashmail.com',
  'getnada.com',
  'sharklasers.com',
  'dispostable.com',
  'fakeinbox.com',
  'maildrop.cc',
  'mohmal.com',
  'burnermail.io',
  'discard.email',
]);

const BLOCKED_LOCAL_PARTS = new Set([
  'test',
  'fake',
  'asdf',
  'qwerty',
  'admin',
  'noreply',
  'no-reply',
  'null',
  'undefined',
]);

function validateStudentEmail(rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
    return { valid: false, error: 'Please enter a valid student email address.' };
  }
  const [localPart, domain] = email.split('@');
  if (!localPart || !domain || localPart.length < 2) {
    return { valid: false, error: 'Please enter a valid student email address.' };
  }
  if (BLOCKED_LOCAL_PARTS.has(localPart)) {
    return {
      valid: false,
      error: 'Please use your real personal or university email rather than a placeholder email.',
    };
  }
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return {
      valid: false,
      error: 'Temporary or disposable email addresses are not allowed. Please use a permanent email.',
    };
  }
  return { valid: true, email };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  const [salt, key] = String(storedHash || '').split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(derived, 'hex'));
}

function getDailyDayKey(timestampMs) {
  const dateObj = new Date(timestampMs);
  if (!Number.isFinite(dateObj.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DAILY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dateObj);
  const year = parts.find((p) => p.type === 'year')?.value || '';
  const month = parts.find((p) => p.type === 'month')?.value || '';
  const day = parts.find((p) => p.type === 'day')?.value || '';
  return `${year}-${month}-${day}`;
}

function getEffectiveQuestionsUsed(student, nowMs = Date.now()) {
  const rawUsed = Number(student?.questions_used || 0);
  if (rawUsed <= 0) return 0;
  const todayKey = getDailyDayKey(nowMs);
  const updatedMs = student?.updated_at ? new Date(student.updated_at).getTime() : NaN;
  const windowStartMs = student?.free_window_started_at
    ? new Date(student.free_window_started_at).getTime()
    : NaN;
  const refMs = Number.isFinite(updatedMs) ? updatedMs : windowStartMs;
  if (!Number.isFinite(refMs)) return 0;
  return getDailyDayKey(refMs) !== todayKey ? 0 : rawUsed;
}

async function supabaseRequest(path, options = {}) {
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !serviceKey) {
    const visibleKeys = Object.keys(process.env).filter((k) => k.includes('SUPABASE'));
    throw new Error(
      `Missing in Vercel runtime: ${!supabaseUrl ? 'SUPABASE_URL ' : ''}${!serviceKey ? 'SUPABASE_SERVICE_ROLE_KEY' : ''} (Found keys: ${visibleKeys.length ? visibleKeys.join(', ') : 'none'})`
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
    const msg = data?.message || data?.error || `Supabase error (${response.status})`;
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
    const action = String(body?.action || 'login').trim();
    const emailCheck = validateStudentEmail(body?.email);
    if (!emailCheck.valid) {
      return res.status(400).json({ error: emailCheck.error });
    }
    const email = emailCheck.email;
    const password = String(body?.password || '');
    const selectedUnit = typeof body?.selectedUnit === 'string' ? body.selectedUnit.trim() : null;
    const deviceId = String(body?.deviceId || body?.device_id || '').trim().slice(0, 128) || null;

    // Look up existing student in Supabase
    const rows = await supabaseRequest(`students?email=eq.${encodeURIComponent(email)}&select=*`);
    const existingStudent = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    const nowMs = Date.now();

    // Action 1: Update selected unit for an already signed-in student
    if (action === 'update_unit') {
      if (!existingStudent) {
        return res.status(404).json({ error: 'Student account not found.' });
      }
      const patchBody = {
        selected_unit: selectedUnit,
        updated_at: new Date(nowMs).toISOString(),
      };
      if (deviceId) patchBody.device_id = deviceId;
      const updated = await supabaseRequest(`students?email=eq.${encodeURIComponent(email)}`, {
        method: 'PATCH',
        body: JSON.stringify(patchBody),
      });
      const student = updated?.[0] || existingStudent;
      return res.status(200).json({
        student: {
          email: student.email,
          selectedUnit: student.selected_unit || null,
          questionsUsed: getEffectiveQuestionsUsed(student, nowMs),
          passExpiresAt: student.pass_expires_at ? new Date(student.pass_expires_at).getTime() : 0,
        },
      });
    }

    // Action 2: Refresh student usage & 24-hour pass status from Supabase
    if (action === 'sync') {
      if (!existingStudent) {
        return res.status(404).json({ error: 'Student account not found.' });
      }
      if (deviceId && !existingStudent.device_id) {
        await supabaseRequest(`students?email=eq.${encodeURIComponent(email)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            device_id: deviceId,
            updated_at: new Date(nowMs).toISOString(),
          }),
        }).catch(() => null);
      }
      return res.status(200).json({
        student: {
          email: existingStudent.email,
          selectedUnit: existingStudent.selected_unit || null,
          questionsUsed: getEffectiveQuestionsUsed(existingStudent, nowMs),
          passExpiresAt: existingStudent.pass_expires_at
            ? new Date(existingStudent.pass_expires_at).getTime()
            : 0,
        },
      });
    }

    // Action 3: Sign In or Create Student Account
    if (!password || password.length < 8) {
      return res.status(400).json({
        error:
          'Please enter a strong password (at least 8 characters with uppercase, lowercase, number, and symbol).',
      });
    }

    if (existingStudent) {
      const valid = verifyPassword(password, existingStudent.password_hash);
      if (!valid) {
        return res.status(401).json({
          error:
            'Incorrect password for this student email. Please enter the password you created.',
        });
      }
      if (deviceId) {
        await supabaseRequest(`students?email=eq.${encodeURIComponent(email)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            device_id: deviceId,
            updated_at: new Date(nowMs).toISOString(),
          }),
        }).catch(() => null);
      }
      return res.status(200).json({
        isNewUser: false,
        student: {
          email: existingStudent.email,
          selectedUnit: existingStudent.selected_unit || null,
          questionsUsed: getEffectiveQuestionsUsed(existingStudent, nowMs),
          passExpiresAt: existingStudent.pass_expires_at
            ? new Date(existingStudent.pass_expires_at).getTime()
            : 0,
        },
      });
    }

    // First-time student: create a new record in Supabase
    const passwordHash = hashPassword(password);
    const created = await supabaseRequest('students', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password_hash: passwordHash,
        questions_used: 0,
        device_id: deviceId,
      }),
    });
    const newStudent = created?.[0];
    return res.status(201).json({
      isNewUser: true,
      student: {
        email: newStudent.email,
        selectedUnit: null,
        questionsUsed: 0,
        passExpiresAt: 0,
      },
    });
  } catch (error) {
    console.error('Matrix AI /api/auth error:', error);
    return res.status(500).json({
      error: error?.message || 'Could not connect to student database.',
    });
  }
}
