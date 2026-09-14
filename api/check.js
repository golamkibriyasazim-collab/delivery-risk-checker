const REAL_API = process.env.FRAUD_API_URL
  || 'https://infodokan.nagad.us.cc/Fraud_Checker/Fraud-ck.php';

const hits = new Map();
const WINDOW = 60 * 1000;
const MAX_HITS = 20;

function rateLimit(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { count: 0, reset: now + WINDOW };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + WINDOW; }
  rec.count++;
  hits.set(ip, rec);
  return rec.count <= MAX_HITS;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
          || req.socket?.remoteAddress || 'unknown';
  if (!rateLimit(ip)) {
    return res.status(429).json({ success: false, error: 'Too many requests' });
  }

  const phone = String(req.query.phone || '').replace(/\D/g, '');
  if (phone.length < 10 || phone.length > 15) {
    return res.status(400).json({ success: false, error: 'Invalid phone number' });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    const upstream = await fetch(`${REAL_API}?phone=${encodeURIComponent(phone)}`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 RiskChecker/1.0',
        'Accept': 'application/json, text/plain, */*'
      }
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        success: false, error: 'Upstream error ' + upstream.status
      });
    }

    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); }
    catch { return res.status(502).json({ success: false, error: 'Invalid JSON from upstream' }); }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json(data);

  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Upstream timeout' : 'Connection failed';
    return res.status(502).json({ success: false, error: msg });
  }
};
