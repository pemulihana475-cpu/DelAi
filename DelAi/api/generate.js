export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { prompt } = req.body || {};
  const HF = process.env.HUGGINGFACE_TOKEN;
  if (!HF) return res.status(500).json({ error: 'Server: HUGGINGFACE_TOKEN belum di-set' });
  if (!prompt) return res.status(400).json({ error: 'Prompt kosong' });

  const url = 'https://api-inference.huggingface.co/models/cerspense/zeroscope_v2_576w';
  const tryOnce = async () => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${HF}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: prompt, parameters: { num_frames: 16 } }),
    });
    return r;
  };

  try {
    let r = await tryOnce();
    for (let i = 0; i < 2 && (r.status === 503 || r.status === 504); i++) {
      await new Promise(s => setTimeout(s, 12000));
      r = await tryOnce();
    }
    if (!r.ok) { const t = await r.text(); return res.status(502).json({ error: `HF ${r.status}: ${t.slice(0,200)}` }); }
    const buf = Buffer.from(await r.arrayBuffer());
    return res.status(200).json({ success: true, videoUrl: `data:video/mp4;base64,${buf.toString('base64')}` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
