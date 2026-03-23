'use strict';

const S = {
  data: null, file: null,
  view: 'txt', tab: 'file',
  poll: null,
  hist: JSON.parse(localStorage.getItem('ps_h') || '[]'),
};

document.addEventListener('DOMContentLoaded', () => {
  renderHist();
  checkApi();
  setInterval(checkApi, 15000);
  // Fix theme icon
  const dark = document.documentElement.dataset.theme === 'dark';
  document.getElementById('themeBtn').textContent = dark ? '🔆' : '🌙';
  document.getElementById('btnTxt').textContent = 'Lancer la transcription';
  document.getElementById('btnIco').textContent = '';
});

/* THEME */
(function(){
  const t = localStorage.getItem('ps_theme');
  if(t) document.documentElement.dataset.theme = t;
})();

function toggleTheme(){
  const html = document.documentElement;
  const dark = html.dataset.theme === 'dark';
  html.dataset.theme = dark ? 'light' : 'dark';
  document.getElementById('themeBtn').textContent = dark ? 'LUNE' : 'SOLEIL';
  localStorage.setItem('ps_theme', html.dataset.theme);
}

/* TABS SOURCE */
function switchTab(tab, btn){
  S.tab = tab;
  document.getElementById('tab-file').style.display = tab==='file' ? '' : 'none';
  document.getElementById('tab-url').style.display  = tab==='url'  ? '' : 'none';
  document.querySelectorAll('#srcTabs .tab').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
}

/* TABS VUE */
function switchView(view, btn){
  S.view = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
  document.getElementById('view-' + view).classList.add('on');
  document.querySelectorAll('#viewTabs .tab').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
}

/* FICHIER */
function dragOver(e){ e.preventDefault(); document.getElementById('dropZone').classList.add('drag'); }
function dragLeave(){ document.getElementById('dropZone').classList.remove('drag'); }
function drop(e){
  e.preventDefault();
  document.getElementById('dropZone').classList.remove('drag');
  if(e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
}
function fileChosen(i){ if(i.files[0]) setFile(i.files[0]); }

function setFile(f){
  S.file = f;
  document.getElementById('fico').textContent = 'audio';
  document.getElementById('fname').textContent = f.name;
  document.getElementById('fsize').textContent = fmtBytes(f.size);
  document.getElementById('fchip').classList.add('on');
}
function rmFile(){
  S.file = null;
  document.getElementById('fchip').classList.remove('on');
  document.getElementById('fi').value = '';
}
function fmtBytes(b){
  if(b < 1024) return b+' B';
  if(b < 1048576) return (b/1024).toFixed(0)+' KB';
  return (b/1048576).toFixed(1)+' MB';
}

/* API HEALTH */
async function checkApi(){
  const dot = document.getElementById('apiDot');
  const lbl = document.getElementById('apiLbl');
  dot.className = 'api-dot chk'; lbl.textContent = '...';
  try {
    const r = await fetch(base()+'/health', { signal: AbortSignal.timeout(5000) });
    if(r.ok){
      dot.className = 'api-dot on'; lbl.textContent = 'Connectee';
    } else throw new Error('HTTP '+r.status);
  } catch {
    dot.className = 'api-dot off'; lbl.textContent = 'Hors ligne';
  }
}

/* TRANSCRIPTION */
async function go(){
  const lang  = document.getElementById('langSrc').value;
  const model = document.getElementById('mdl').value;
  const diar  = document.getElementById('chkD').checked;
  const aln   = document.getElementById('chkA').checked;
  const url   = document.getElementById('urlIn').value.trim();

  if(S.tab==='url' && !url){ toast('Entrez une URL','err'); return; }
  if(S.tab==='file' && !S.file){ toast('Selectionnez un fichier','err'); return; }

  busy(true); setStatus('Envoi du fichier...','run'); prog(15);

  try {
    let res;
    if(S.tab==='url'){
      res = await fetch(base()+'/speech-to-text-url', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ url, whisper_model:model, ...(lang&&{language:lang}), ...(diar&&{diarize:true}), ...(aln&&{align:true}) }),
      });
    } else {
      const fd = new FormData();
      fd.append('file', S.file);
      fd.append('whisper_model', model);
      if(lang) fd.append('language', lang);
      if(diar) fd.append('diarize','true');
      if(aln)  fd.append('align','true');
      res = await fetch(base()+'/speech-to-text', { method:'POST', body:fd });
    }

    if(!res.ok) throw new Error('Serveur HTTP '+res.status);
    const data = await res.json();

    if(data.segments || data.text){ done(data); return; }

    const id = data.identifier || data.task_id || data.id;
    if(!id) throw new Error('Pas d\'identifiant de tache');
    setStatus('Transcription en cours...','run'); prog(40);
    pollTask(id);

  } catch(err){
    setStatus('Erreur : '+err.message,'err');
    prog(-1); busy(false);
    toast(err.message,'err',5000);
  }
}

function pollTask(id){
  let d = 0;
  S.poll = setInterval(async () => {
    try {
      const r    = await fetch(`${base()}/task/${id}`);
      const data = await r.json();
      const st   = (data.status||data.state||'').toLowerCase();
      d = (d+1)%4;
      setStatus('Traitement'+'.'.repeat(d+1),'run');
      if(['done','success','completed'].includes(st)){
        clearInterval(S.poll); done(data.result||data);
      } else if(['failure','failed','error'].includes(st)){
        clearInterval(S.poll); throw new Error(data.error||'Echec serveur');
      }
    } catch(err){
      clearInterval(S.poll);
      setStatus('Erreur : '+err.message,'err');
      prog(-1); busy(false);
      toast(err.message,'err',5000);
    }
  }, 2000);
}

/* AFFICHAGE */
function done(data){
  S.data = data;
  prog(100); setStatus('Termine !','ok'); busy(false);
  document.getElementById('btnTrd').disabled = false;
  showTxt(data); showStats(data); showSegs(data); showJson(data);
  addHist(data);
  setTimeout(()=>prog(-1), 800);
  toast('Transcription terminee !','ok');
}

function plain(data){
  if(data?.text?.trim()) return data.text;
  if(Array.isArray(data?.segments)) return data.segments.map(s=>s.text||'').join(' ').trim();
  return JSON.stringify(data,null,2);
}

function showTxt(data){
  const el = document.getElementById('resTxt');
  // Format text with paragraphs — split on sentence endings
  const raw = plain(data);
  const formatted = raw
    .replace(/([.!?])\s+/g, '$1\n\n')
    .trim();
  el.textContent = formatted;
  el.style.display = '';
  document.getElementById('ph-txt').style.display = 'none';
}

function showStats(data){
  const t = plain(data);
  const segs = data.segments||[];
  const last = segs[segs.length-1];
  document.getElementById('sW').textContent = t.trim().split(/\s+/).filter(Boolean).length.toLocaleString('fr');
  document.getElementById('sC').textContent = t.length.toLocaleString('fr');
  document.getElementById('sS').textContent = segs.length;
  document.getElementById('sD').textContent = last ? fmtTime(last.end) : '---';
  document.getElementById('statsBar').style.display = '';
}

function showSegs(data){
  const list = document.getElementById('resSeg');
  list.innerHTML = '';
  const segs = data.segments||[];
  if(!segs.length){
    list.innerHTML = '<p style="color:var(--text3);padding:1rem;font-size:.82rem">Aucun segment disponible.</p>';
    list.style.display = '';
    document.getElementById('ph-seg').style.display = 'none';
    return;
  }
  segs.forEach(s=>{
    const d = document.createElement('div');
    d.className = 'seg';
    d.innerHTML = `
      <div class="seg-meta">
        <div class="seg-t">${fmtTime(s.start)}<br>${fmtTime(s.end)}</div>
        ${s.speaker ? `<div class="seg-spk">${esc(s.speaker)}</div>` : ''}
      </div>
      <div class="seg-txt">${esc(s.text||'')}</div>`;
    list.appendChild(d);
  });
  list.style.display = '';
  document.getElementById('ph-seg').style.display = 'none';
}

function showJson(data){
  const el = document.getElementById('resJsn');
  el.textContent = JSON.stringify(data,null,2);
  el.style.display = '';
  document.getElementById('ph-jsn').style.display = 'none';
}

/* TRADUCTION */
async function translate(){
  if(!S.data){ toast('Transcrivez d\'abord','err'); return; }
  const key = document.getElementById('cKey').value.trim();
  if(!key){ toast('Cle Claude manquante dans Parametres API','err',4000); return; }

  const lang  = document.getElementById('trdLang').value;
  const tone  = document.getElementById('trdTone').value;
  const src   = plain(S.data);
  const names = {fr:'francais',en:'anglais',es:'espagnol',de:'allemand',it:'italien',pt:'portugais',ar:'arabe',zh:'chinois',ja:'japonais'};

  const box = document.getElementById('resTrd');
  const ph  = document.getElementById('ph-trd');
  box.style.display = 'none'; ph.style.display = '';
  ph.querySelector('p').textContent = 'Traduction en cours...';
  document.getElementById('btnTrd').disabled = true;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-api-key': key,
        'anthropic-version':'2023-06-01',
        'anthropic-dangerous-direct-browser-access':'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages:[{ role:'user', content:`Traduis ce texte de podcast en ${names[lang]||lang}, ton ${tone}. Reponds uniquement avec la traduction, sans commentaires.\n\n${src}` }],
      }),
    });
    const d = await r.json();
    if(!r.ok) throw new Error(d.error?.message||'Erreur API');
    box.textContent = d.content?.[0]?.text || '';
    box.style.display = ''; ph.style.display = 'none';
    toast('Traduction terminee','ok');
  } catch(err){
    ph.querySelector('p').textContent = 'Erreur : '+err.message;
    toast(err.message,'err',5000);
  } finally {
    document.getElementById('btnTrd').disabled = false;
  }
}

/* EXPORTS */
function cpView(){
  let t = '';
  if(S.view==='txt') t = document.getElementById('resTxt').textContent;
  if(S.view==='trd') t = document.getElementById('resTrd').textContent;
  if(S.view==='jsn') t = document.getElementById('resJsn').textContent;
  if(S.view==='seg') t = (S.data?.segments||[]).map(s=>`[${fmtTime(s.start)}]\n${s.text}`).join('\n\n');
  if(!t){ toast('Rien a copier','err'); return; }
  navigator.clipboard.writeText(t).then(()=>toast('Copie !','inf'));
}
function cpTrd(){
  const t = document.getElementById('resTrd').textContent;
  if(!t){ toast('Pas de traduction','err'); return; }
  navigator.clipboard.writeText(t).then(()=>toast('Copie !','inf'));
}
function dl(content, name, type='text/plain;charset=utf-8'){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content],{type}));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
function dlTxt(){ if(!S.data){toast('Pas de transcription','err');return;} dl(plain(S.data),'transcription.txt'); toast('Telechargement...','inf'); }
function dlJson(){ if(!S.data){toast('Pas de transcription','err');return;} dl(JSON.stringify(S.data,null,2),'transcription.json','application/json'); toast('Telechargement...','inf'); }
function dlSrt(){
  const segs = S.data?.segments;
  if(!segs?.length){toast('Pas de segments','err');return;}
  const srt = segs.map((s,i)=>`${i+1}\n${toSrt(s.start)} --> ${toSrt(s.end)}\n${(s.text||'').trim()}\n`).join('\n');
  dl(srt,'transcription.srt'); toast('Telechargement...','inf');
}
function dlTrd(){
  const t = document.getElementById('resTrd').textContent;
  if(!t){toast('Pas de traduction','err');return;}
  dl(t,'traduction.txt'); toast('Telechargement...','inf');
}

/* HISTORIQUE */
function addHist(data){
  const name = S.file?.name || document.getElementById('urlIn').value.split('/').pop() || 'transcription';
  S.hist.unshift({ name, date: new Date().toLocaleString('fr'), data });
  if(S.hist.length > 10) S.hist.pop();
  localStorage.setItem('ps_h', JSON.stringify(S.hist));
  renderHist();
}
function renderHist(){
  const list = document.getElementById('histList');
  list.innerHTML = '';
  if(!S.hist.length){ list.innerHTML='<li class="hist-empty">Aucune transcription</li>'; return; }
  S.hist.forEach(e=>{
    const li = document.createElement('li');
    li.className = 'hist-item';
    li.innerHTML = `<span>doc</span><span class="hi-name">${esc(e.name)}</span><span class="hi-date">${e.date}</span>`;
    li.onclick = ()=>{ done(e.data); toast('Restaure','inf'); };
    list.appendChild(li);
  });
}
function clearHist(){
  S.hist = []; localStorage.removeItem('ps_h');
  renderHist(); toast('Efface','inf');
}

/* HELPERS UI */
function base(){ return (document.getElementById('apiUrl').value.trim().replace(/\/$/,'')) || 'http://127.0.0.1:8000'; }
function busy(b){
  document.getElementById('btnGo').disabled = b;
  document.getElementById('btnIco').textContent = '';
  document.getElementById('btnTxt').textContent = b ? 'Transcription en cours...' : 'Lancer la transcription';
  document.getElementById('waveform').classList.toggle('on', b);
}
function setStatus(msg, s='idle'){
  document.getElementById('smsg').textContent = msg;
  document.getElementById('sdot').className = 'sdot '+s;
}
function prog(pct){
  const w = document.getElementById('progWrap');
  if(pct < 0){ w.style.display='none'; return; }
  w.style.display='';
  document.getElementById('progFill').style.width = Math.min(pct,100)+'%';
}
function toast(msg, type='inf', ms=2600){
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = `toast show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(()=>el.classList.remove('show'), ms);
}

/* UTILS */
function fmtTime(s){
  if(s==null||isNaN(s)) return '??:??';
  const m = Math.floor(s/60);
  return `${String(m).padStart(2,'0')}:${(s%60).toFixed(1).padStart(4,'0')}`;
}
function toSrt(s){
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sc=Math.floor(s%60), ms=Math.round((s%1)*1000);
  return `${p2(h)}:${p2(m)}:${p2(sc)},${String(ms).padStart(3,'0')}`;
}
function p2(n){ return String(n).padStart(2,'0'); }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
