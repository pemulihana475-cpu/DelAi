import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!URL || !SERVICE) return res.status(500).json({ error: 'Env SUPABASE_URL / SERVICE_ROLE belum di-set' });

  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '');
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  const { data: ud, error: ue } = await admin.auth.getUser(token);
  if (ue || !ud.user) return res.status(401).json({ error: 'Unauthorized' });
  const role = (ud.user.app_metadata && ud.user.app_metadata.role) || (ud.user.user_metadata && ud.user.user_metadata.role);
  if (role !== 'admin') return res.status(403).json({ error: 'Bukan admin' });

  const { action, ...p } = req.body || {};
  try {
    switch (action) {
      case 'get_settings': { const { data } = await admin.from('settings').select('value').eq('key','app').single(); return res.json({ value: data ? data.value : {} }); }
      case 'save_settings': { await admin.from('settings').upsert({ key:'app', value:p.value }); return res.json({ ok:true }); }

      case 'stats': {
        const { count: users } = await admin.from('profiles').select('*', { count:'exact', head:true });
        const { count: videos } = await admin.from('videos').select('*', { count:'exact', head:true });
        const { count: processing } = await admin.from('videos').select('*', { count:'exact', head:true }).eq('status','processing');
        const { count: pending } = await admin.from('transactions').select('*', { count:'exact', head:true }).eq('status','pending');
        const { data: paid } = await admin.from('transactions').select('price,credits_added').eq('status','paid');
        const revenue = (paid||[]).reduce((s,t)=>s+t.price,0);
        const creditsSold = (paid||[]).reduce((s,t)=>s+t.credits_added,0);
        const { data: allV } = await admin.from('videos').select('created_at');
        const daily = {}; for (let i=6;i>=0;i--){ daily[i]=0; }
        (allV||[]).forEach(v=>{ const x=new Date(v.created_at); x.setHours(0,0,0,0); for(let i=6;i>=0;i--){ const d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-i); if(x.getTime()===d.getTime()) daily[i]++; } });
        return res.json({ users, videos, processing, pending, revenue, creditsSold, daily });
      }

      case 'list_users': {
        const { data: prof } = await admin.from('profiles').select('*');
        const { data: vids } = await admin.from('videos').select('user_id');
        const cnt = {}; (vids||[]).forEach(v=>cnt[v.user_id]=(cnt[v.user_id]||0)+1);
        return res.json((prof||[]).map(u=>({...u, vcount: cnt[u.id]||0 })));
      }
      case 'add_user': {
        const { data: nu, error } = await admin.auth.admin.createUser({ email:p.email, password:'Admin@123', email_confirm:true, user_metadata:{ name:p.name } });
        if (error) throw error;
        await admin.from('profiles').insert({ id:nu.user.id, name:p.name, email:p.email, credits:0 });
        return res.json({ ok:true });
      }
      case 'edit_user': { await admin.from('profiles').update({ name:p.name }).eq('id',p.id); return res.json({ ok:true }); }
      case 'update_credits': { const { data } = await admin.from('profiles').select('credits').eq('id',p.id).single(); await admin.from('profiles').update({ credits: Math.max(0,(data.credits||0)+p.delta) }).eq('id',p.id); return res.json({ ok:true }); }
      case 'set_blocked': { const { data } = await admin.from('profiles').select('blocked').eq('id',p.id).single(); await admin.from('profiles').update({ blocked:!data.blocked }).eq('id',p.id); return res.json({ ok:true }); }
      case 'delete_user': { await admin.from('profiles').delete().eq('id',p.id); return res.json({ ok:true }); }

      case 'list_videos': { const { data } = await admin.from('videos').select('*, profiles(name)').order('created_at',{ascending:false}); return res.json(data||[]); }
      case 'feature_video': { const { data } = await admin.from('videos').select('featured').eq('id',p.id).single(); await admin.from('videos').update({ featured:!data.featured }).eq('id',p.id); return res.json({ ok:true }); }
      case 'delete_video': { await admin.from('videos').delete().eq('id',p.id); return res.json({ ok:true }); }

      case 'list_tx': { const { data } = await admin.from('transactions').select('*, profiles(name)').order('created_at',{ascending:false}); return res.json(data||[]); }
      case 'approve_tx': { const { data:tx } = await admin.from('transactions').select('*').eq('id',p.id).single(); if(tx.status!=='pending') return res.json({ ok:true }); await admin.from('transactions').update({ status:'paid' }).eq('id',tx.id); const { data:pr } = await admin.from('profiles').select('credits').eq('id',tx.user_id).single(); await admin.from('profiles').update({ credits:(pr.credits||0)+tx.credits_added }).eq('id',tx.user_id); return res.json({ ok:true }); }
      case 'reject_tx': { await admin.from('transactions').update({ status:'rejected' }).eq('id',p.id); return res.json({ ok:true }); }

      case 'list_ann': { const { data } = await admin.from('announcements').select('*').order('created_at',{ascending:false}); return res.json(data||[]); }
      case 'save_ann': { await admin.from('announcements').insert({ title:p.title, body:p.body, active:p.active }); return res.json({ ok:true }); }
      case 'toggle_ann': { await admin.from('announcements').update({ active:p.active }).eq('id',p.id); return res.json({ ok:true }); }
      case 'delete_ann': { await admin.from('announcements').delete().eq('id',p.id); return res.json({ ok:true }); }

      case 'export': { const [a,b,c,d,e] = await Promise.all([admin.from('profiles').select('*'),admin.from('videos').select('*'),admin.from('transactions').select('*'),admin.from('settings').select('*'),admin.from('announcements').select('*')]); return res.json({ profiles:a.data, videos:b.data, transactions:c.data, settings:d.data, announcements:e.data }); }
      case 'import': { const D=p.data||{}; if(D.profiles&&D.profiles.length) await admin.from('profiles').upsert(D.profiles); if(D.videos&&D.videos.length) await admin.from('videos').upsert(D.videos); if(D.transactions&&D.transactions.length) await admin.from('transactions').upsert(D.transactions); if(D.settings&&D.settings.length) await admin.from('settings').upsert(D.settings); if(D.announcements&&D.announcements.length) await admin.from('announcements').upsert(D.announcements); return res.json({ ok:true }); }
      case 'wipe': { await Promise.all([admin.from('videos').delete(),admin.from('transactions').delete(),admin.from('announcements').delete(),admin.from('profiles').delete()]); return res.json({ ok:true }); }
      default: return res.status(400).json({ error: 'Action tidak dikenal: '+action });
    }
  } catch (e) { return res.status(500).json({ error: e.message }); }
          }
