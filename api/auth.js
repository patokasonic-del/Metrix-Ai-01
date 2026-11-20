import crypto from 'node:crypto';

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

async function supabaseRequest(path, options = {}) {
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Server configuration error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in Vercel.');
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {}),
    },
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
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');
    const selectedUnit = typeof body?.selectedUnit === 'string' ? body.selectedUnit.trim() : null;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid student email address.' });
    }

    // Look up existing student in Supabase
    const rows = await supabaseRequest(
      `students?email=eq.${encodeURIComponent(email)}&select=*`
    );
    const existingStudent = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

    // Action 1: Update selected unit for an already signed-in student
    if (action === 'update_unit') {
      if (!existingStudent) {
        return res.status(404).json({ error: 'Student account not found.' });
      }
      const updated = await supabaseRequest(
        `students?email=eq.${encodeURIComponent(email)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            selected_unit: selectedUnit,
            updated_at: new Date().toISOString(),
          }),
        }
      );
      const student = updated?.[0] || existingStudent;
      return res.status(200).json({
        student: {
          email: student.email,
          selectedUnit: student.selected_unit || null,
          questionsUsed: student.questions_used || 0,
          passExpiresAt: student.pass_expires_at ? new Date(student.pass_expires_at).getTime() : 0,
        },
      });
    }

    // Action 2: Refresh student usage & 24-hour pass status from Supabase
    if (action === 'sync') {
      if (!existingStudent) {
        return res.status(404).json({ error: 'Student account not found.' });
      }
      return res.status(200).json({
        student: {
          email: existingStudent.email,
          selectedUnit: existingStudent.selected_unit || null,
          questionsUsed: existingStudent.questions_used || 0,
          passExpiresAt: existingStudent.pass_expires_at
            ? new Date(existingStudent.pass_expires_at).getTime()
            : 0,
        },
      });
    }

    // Action 3: Sign In or Create Student Account
    if (!password || password.length < 8) {
      return res.status(400).json({
        error: 'Please enter a strong password (at least 8 characters with uppercase, lowercase, number, and symbol).',
      });
    }

    if (existingStudent) {
      // Returning student: verify their password and return their saved usage & 24h pass state
      const valid = verifyPassword(password, existingStudent.password_hash);
      if (!valid) {
        return res.status(401).json({
          error: 'Incorrect password for this student email. Please enter the password you created.',
        });
      }

      return res.status(200).json({
        isNewUser: false,
        student: {
          email: existingStudent.email,
          selectedUnit: existingStudent.selected_unit || null,
          questionsUsed: existingStudent.questions_used || 0,
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
