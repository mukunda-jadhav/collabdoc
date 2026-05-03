/* ═══════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════ */
const state = {
  roomId: null, userName: null,
  userId: 'u_' + Math.random().toString(36).slice(2,10),
  version: 0, lastContent: '',
  activeUsers: {}, saveTimer: null, typingTimer: null,
  isRemoteUpdate: false, savedRange: null,
  editingChartId: null 
};

/* ═══════════════════════════════════════════════════
   SOCKET
═══════════════════════════════════════════════════ */
const socket = io();

socket.on('connect',     () => setConn(true));
socket.on('disconnect', () => setConn(false));

socket.on('room:state', ({ content, version, activeUsers, activity, title }) => {
  state.version = version || 0;
  state.lastContent = content || '';
  state.isRemoteUpdate = true;
  getEd().innerHTML = content || '';
  state.isRemoteUpdate = false;
  updateCounts(); renderUsers(activeUsers); renderActivity(activity);
  document.getElementById('doc-title').textContent = title || 'Untitled';
  loading(false);
  rehydrateCharts();
});

socket.on('doc:update', ({ content, version, userId }) => {
  if (userId === state.userId) return;
  const ed = getEd(), sel = saveSel(ed);
  state.isRemoteUpdate = true;
  ed.innerHTML = content;
  state.isRemoteUpdate = false;
  restoreSel(ed, sel);
  state.lastContent = content; state.version = version;
  updateCounts(); rehydrateCharts();
});

socket.on('users:update',    u  => renderUsers(u));
socket.on('activity:update', a  => renderActivity(a));
socket.on('user:joined', ({ name }) => toast(`${name} joined`));
socket.on('user:left',    ({ userId }) => { delete state.activeUsers[userId]; renderUsersBar(); });
socket.on('user:typing', ({ name }) => {
  const el = document.getElementById('typing-indicator');
  el.textContent = `${name} is typing…`; el.classList.remove('hidden');
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => el.classList.add('hidden'), 2000);
});
socket.on('error', ({ message }) => toast('Error: ' + message, true));

/* ═══════════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════════ */
function switchTab(t) {
  const c = t === 'create';
  document.getElementById('create-tab').classList.toggle('hidden', !c);
  document.getElementById('join-tab').classList.toggle('hidden', c);
  const on  = 'flex-1 py-3.5 text-sm font-medium transition-all text-blue-600 border-b-2 border-blue-600 bg-blue-50/50';
  const off = 'flex-1 py-3.5 text-sm font-medium transition-all text-gray-500 border-b-2 border-transparent hover:text-gray-900';
  document.getElementById('tab-create').className = c  ? on : off;
  document.getElementById('tab-join').className   = !c ? on : off;
}

async function createRoom() {
  const name = v('c-name'), title = v('c-title'), code = v('c-code');
  hide('c-error');
  if (!name) return err('c-error','Please enter your name.');
  if (code.length < 4) return err('c-error','Access code must be at least 4 characters.');
  loading(true,'Creating room…');
  try {
    const res = await post('/api/rooms/create', { name, title, accessCode: code });
    const data = await res.json();
    if (!res.ok) { loading(false); return err('c-error', data.error || 'Failed.'); }
    state.roomId = data.roomId; state.userName = name;
    launch(data.roomId, data.title || title || 'Untitled');
  } catch { loading(false); err('c-error','Server unreachable.'); }
}

async function joinRoom() {
  const name = v('j-name'), roomId = v('j-room').toUpperCase(), code = v('j-code');
  hide('j-error');
  if (!name)   return err('j-error','Please enter your name.');
  if (!roomId) return err('j-error','Please enter the Room ID.');
  if (!code)   return err('j-error','Please enter the access code.');
  loading(true,'Verifying credentials…');
  try {
    const res = await post('/api/rooms/join', { roomId, accessCode: code });
    const data = await res.json();
    if (!res.ok) { loading(false); return err('j-error', data.error || 'Failed.'); }
    state.roomId = data.roomId; state.userName = name;
    launch(data.roomId, data.title);
  } catch { loading(false); err('j-error','Server unreachable.'); }
}

function launch(roomId, title) {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('editor-screen').classList.remove('hidden');
  document.getElementById('room-badge').textContent = roomId;
  document.getElementById('doc-title').textContent  = title || 'Untitled';
  document.title = (title || 'Untitled') + ' — CollabDocs';
  socket.emit('room:join', { roomId, name: state.userName, userId: state.userId });
  const ed = getEd();
  ed.addEventListener('input', onInput);
  ed.addEventListener('keyup', onCursorMove);
  ed.addEventListener('mouseup', onCursorMove);
  ed.focus();
}

function leaveRoom() { socket.disconnect(); location.reload(); }

/* ═══════════════════════════════════════════════════
   EDITOR
═══════════════════════════════════════════════════ */
function getEd() { return document.getElementById('editor'); }

function onInput() {
  if (state.isRemoteUpdate) return;
  updateCounts(); setSaving(true);
  socket.emit('user:typing', { roomId: state.roomId });
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(broadcast, 700);
}

function broadcast() {
  const content = getEd().innerHTML;
  if (content === state.lastContent) { setSaving(false); return; }
  state.lastContent = content; state.version++;
  socket.emit('doc:update', { roomId: state.roomId, content, version: state.version });
  setSaving(false);
}

function onCursorMove() {
  socket.emit('cursor:move', { roomId: state.roomId, position: getCursorPos(), name: state.userName });
}

/* ═══════════════════════════════════════════════════
   TEXT FORMATTING
═══════════════════════════════════════════════════ */
function fmt(cmd) {
  getEd().focus();
  if      (cmd==='h1') document.execCommand('formatBlock',false,'h1');
  else if (cmd==='h2') document.execCommand('formatBlock',false,'h2');
  else if (cmd==='h3') document.execCommand('formatBlock',false,'h3');
  else if (cmd==='ul') document.execCommand('insertUnorderedList');
  else if (cmd==='ol') document.execCommand('insertOrderedList');
  else                 document.execCommand(cmd);
  onInput();
}
function setFontSize(val) { if(!val) return; getEd().focus(); document.execCommand('fontSize',false,val); onInput(); }
function setTextColor(c)  { getEd().focus(); document.execCommand('foreColor',false,c); onInput(); }
function setHighlight(c)  { getEd().focus(); document.execCommand('hiliteColor',false,c); onInput(); }

/* ═══════════════════════════════════════════════════
   INSERT — TABLES
═══════════════════════════════════════════════════ */
function insertTable(rows, cols) {
  saveCaret();
  const hdr  = '<tr>' + Array(cols).fill().map((_,i)=>`<th>Header ${i+1}</th>`).join('') + '</tr>';
  const body = Array(rows-1).fill().map(()=>'<tr>'+Array(cols).fill('<td>Cell</td>').join('')+'</tr>').join('');
  restoreCaret();
  insertHTML(`<br><table>${hdr}${body}</table><br>`);
}
function showCustomTable() {
  closeMenus(); saveCaret();
  document.getElementById('table-modal').classList.remove('hidden');
}
function insertCustomTable() {
  const r = Math.max(1,Math.min(20,parseInt(document.getElementById('tbl-rows').value)||3));
  const c = Math.max(1,Math.min(10,parseInt(document.getElementById('tbl-cols').value)||3));
  document.getElementById('table-modal').classList.add('hidden');
  insertTable(r,c);
}

/* ═══════════════════════════════════════════════════
   INSERT — SHAPES
═══════════════════════════════════════════════════ */
const SHAPES = {
  rect:     `<svg width="200" height="90" viewBox="0 0 200 90" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="192" height="82" rx="8" fill="#dbeafe" stroke="#3b82f6" stroke-width="2"/><text x="100" y="50" text-anchor="middle" fill="#1d4ed8" font-size="14" font-family="Inter,sans-serif">Rectangle</text></svg>`,
  circle:   `<svg width="140" height="140" viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg"><circle cx="70" cy="70" r="65" fill="#ede9fe" stroke="#7c3aed" stroke-width="2"/><text x="70" y="76" text-anchor="middle" fill="#5b21b6" font-size="14" font-family="Inter,sans-serif">Circle</text></svg>`,
  triangle:`<svg width="170" height="150" viewBox="0 0 170 150" xmlns="http://www.w3.org/2000/svg"><polygon points="85,8 165,142 5,142" fill="#d1fae5" stroke="#10b981" stroke-width="2"/><text x="85" y="120" text-anchor="middle" fill="#065f46" font-size="14" font-family="Inter,sans-serif">Triangle</text></svg>`,
  star:     `<svg width="150" height="150" viewBox="0 0 150 150" xmlns="http://www.w3.org/2000/svg"><polygon points="75,8 90,55 140,55 100,82 115,135 75,105 35,135 50,82 10,55 60,55" fill="#fef9c3" stroke="#eab308" stroke-width="2"/><text x="75" y="80" text-anchor="middle" fill="#713f12" font-size="12" font-family="Inter,sans-serif">Star</text></svg>`,
  arrow:    `<svg width="210" height="70" viewBox="0 0 210 70" xmlns="http://www.w3.org/2000/svg"><polygon points="0,22 165,22 165,5 210,35 165,65 165,48 0,48" fill="#fee2e2" stroke="#ef4444" stroke-width="2"/><text x="90" y="40" text-anchor="middle" fill="#991b1b" font-size="13" font-family="Inter,sans-serif">Arrow</text></svg>`,
  callout: `<svg width="230" height="110" viewBox="0 0 230 110" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="210" height="78" rx="8" fill="#f0fdf4" stroke="#22c55e" stroke-width="1.5"/><polygon points="28,82 55,82 28,108" fill="#f0fdf4" stroke="#22c55e" stroke-width="1.5"/><text x="109" y="48" text-anchor="middle" fill="#166534" font-size="13" font-family="Inter,sans-serif">Callout text here</text></svg>`
};
function insertShape(type) {
  saveCaret();
  const svg = SHAPES[type]; if(!svg) return;
  restoreCaret();
  insertHTML(`<div class="doc-shape-wrap" contenteditable="false">${svg}</div><p><br></p>`);
}

/* ═══════════════════════════════════════════════════
   INSERT — CHARTS (Editable via double-click)
═══════════════════════════════════════════════════ */
let chartCounter = 0;

const DEFAULT_CHART = {
  bar:      { labels:['Jan','Feb','Mar','Apr','May','Jun'], values:[42,58,75,63,90,82], title:'Sales Chart',    color:'#3b82f6' },
  line:     { labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], values:[120,180,95,210,160,240,190], title:'Weekly Visits', color:'#8b5cf6' },
  pie:      { labels:['Product A','Product B','Product C','Product D'], values:[35,25,22,18], title:'Market Share', color:'#10b981' },
  doughnut: { labels:['Q1','Q2','Q3','Q4'], values:[25,30,20,25], title:'Quarterly',    color:'#f59e0b' }
};

const MULTI_COLORS = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#ec4899','#84cc16'];

function insertChart(type) {
  saveCaret();
  chartCounter++;
  const id  = `chart-${chartCounter}-${Date.now()}`;
  const def = DEFAULT_CHART[type];
  restoreCaret();
  insertHTML(
    `<div class="doc-chart-wrap" contenteditable="false"
          data-chart-type="${type}" data-chart-id="${id}"
          data-labels="${def.labels.join(',')}"
          data-values="${def.values.join(',')}"
          data-title="${def.title}"
          data-color="${def.color}">
        <button class="chart-edit-btn" onclick="openChartEdit('${id}')">✏ Edit data</button>
        <canvas id="${id}" width="520" height="240"></canvas>
      </div><p><br></p>`
  );
  setTimeout(() => renderChart(id), 60);
}

function renderChart(id) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const wrap   = canvas.closest('.doc-chart-wrap');
  const type   = wrap.dataset.chartType;
  const labels = wrap.dataset.labels.split(',').map(s=>s.trim());
  const values = wrap.dataset.values.split(',').map(Number);
  const title  = wrap.dataset.title || '';
  const color  = wrap.dataset.color || '#3b82f6';
  const isPie  = type==='pie'||type==='doughnut';

  if (canvas._chartInst) canvas._chartInst.destroy();

  const bgColors = isPie
    ? MULTI_COLORS.slice(0, values.length).map(c=>c+'cc')
    : color+'55';
  const borderColors = isPie
    ? MULTI_COLORS.slice(0, values.length)
    : color;

  canvas._chartInst = new Chart(canvas, {
    type,
    data: {
      labels,
      datasets: [{
        label: title,
        data: values,
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: 2,
        tension: 0.4,
        fill: type==='line',
        pointBackgroundColor: color
      }]
    },
    options: {
      animation: false, // CRITICAL: Disabled so chart is fully rendered immediately for PDF
      responsive: false,
      plugins: {
        legend: { labels: { color:'#374151', font:{ family:'Inter' } } },
        title:  { display: !!title, text: title, color:'#111827', font:{ family:'Inter', size:13, weight:'600' } }
      },
      scales: isPie ? {} : {
        x: { ticks:{ color:'#6b7280' }, grid:{ color:'#f3f4f6' } },
        y: { ticks:{ color:'#6b7280' }, grid:{ color:'#f3f4f6' } }
      }
    }
  });
}

function rehydrateCharts() {
  setTimeout(() => {
    document.querySelectorAll('#editor .doc-chart-wrap').forEach(wrap => {
      const id = wrap.dataset.chartId;
      if (id) renderChart(id);
    });
  }, 80);
}

function openChartEdit(id) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const wrap = canvas.closest('.doc-chart-wrap');
  state.editingChartId = id;
  document.getElementById('chart-edit-title').value  = wrap.dataset.title  || '';
  document.getElementById('chart-edit-labels').value = wrap.dataset.labels || '';
  document.getElementById('chart-edit-values').value = wrap.dataset.values || '';
  document.getElementById('chart-edit-color').value  = wrap.dataset.color  || '#3b82f6';
  document.getElementById('chart-modal').classList.remove('hidden');
}

function applyChartEdit() {
  const id = state.editingChartId; if (!id) return;
  const canvas = document.getElementById(id); if (!canvas) return;
  const wrap   = canvas.closest('.doc-chart-wrap');
  wrap.dataset.title  = document.getElementById('chart-edit-title').value.trim();
  wrap.dataset.labels = document.getElementById('chart-edit-labels').value.trim();
  wrap.dataset.values = document.getElementById('chart-edit-values').value.trim();
  wrap.dataset.color  = document.getElementById('chart-edit-color').value;
  document.getElementById('chart-modal').classList.add('hidden');
  renderChart(id);
  onInput(); 
}

/* ═══════════════════════════════════════════════════
   INSERT — MEDIA / MISC
═══════════════════════════════════════════════════ */
function triggerImageUpload() { saveCaret(); document.getElementById('img-upload').click(); }
function handleImageUpload(e) {
  const file = e.target.files[0]; if (!file) return;
  if (!file.type.startsWith('image/')) return toast('Please select an image file.', true);
  const reader = new FileReader();
  reader.onload = ev => {
    restoreCaret();
    insertHTML(`<img src="${ev.target.result}" alt="${file.name}" style="max-width:100%"/><p><br></p>`);
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}
function insertImageUrl() {
  const url = prompt('Enter image URL:'); if (!url||!url.trim()) return;
  insertHTML(`<img src="${url.trim()}" alt="Image" style="max-width:100%"/><p><br></p>`);
}
function insertDivider()   { insertHTML('<hr/><p><br></p>'); }
function insertQuote()     { insertHTML('<blockquote>Quote text here…</blockquote><p><br></p>'); }
function insertCodeBlock() { insertHTML('<pre>// Code here\nconsole.log("Hello!");</pre><p><br></p>'); }

/* ═══════════════════════════════════════════════════
   EXPORT — PDF FIX INCLUDED
═══════════════════════════════════════════════════ */
function downloadAs(format) {
  const ed    = getEd();
  const html  = ed.innerHTML.trim();
  const plain = ed.innerText.trim();
  const title = document.getElementById('doc-title').textContent.trim() || 'document';

  if (!plain) { toast('Document is empty — nothing to download.', true); return; }

  if (format==='html') exportHTML(title, html);
  else if (format==='txt') exportTXT(title, plain);
  else if (format==='md')  exportMD(title, html);
  else if (format==='pdf') exportPDF(title, html);
}

function blobDownload(filename, mime, text) {
  const blob = new Blob([text], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href:url, download:filename });
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  toast('Downloaded: ' + filename);
}

function safeName(s) { return (s||'document').replace(/[^a-z0-9_\-]/gi,'_').replace(/_+/g,'_').slice(0,60); }

function exportCSS() {
  return `*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Georgia,serif;max-width:760px;margin:40px auto;padding:0 32px 80px;color:#1a1a1a;line-height:1.8;font-size:16px;background:#fff}
h1{font-size:2rem;font-weight:700;border-bottom:2px solid #e5e5e5;padding-bottom:.3em;margin:0 0 .4em}
h2{font-size:1.4rem;font-weight:700;margin:1.4em 0 .35em}h3{font-size:1.1rem;font-weight:600;margin:1.2em 0 .3em}
p{margin-bottom:.8em}ul,ol{padding-left:1.6em;margin-bottom:.8em}li{margin-bottom:.25em}
strong,b{font-weight:700}em,i{font-style:italic}
blockquote{border-left:3px solid #3b82f6;padding:.5em 1em;color:#6b7280;font-style:italic;margin:1em 0;background:#eff6ff;border-radius:0 6px 6px 0}
pre{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;font-family:monospace;font-size:.875em;overflow-x:auto;margin:1em 0;white-space:pre-wrap}
code{background:#f8fafc;padding:1px 5px;border-radius:3px;font-family:monospace;font-size:.875em}
table{border-collapse:collapse;width:100%;margin:1em 0;font-size:.9em}
th{background:#f9fafb;font-weight:600;padding:8px 12px;border:1px solid #e5e7eb;text-align:left}
td{padding:7px 12px;border:1px solid #e5e7eb}
img{max-width:100%;height:auto;border-radius:6px;margin:.6em 0;display:block}
hr{border:none;border-top:1px solid #e5e7eb;margin:1.4em 0}
.doc-shape-wrap{text-align:center;margin:1em 0}
.doc-chart-wrap{border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin:1em 0; text-align:center;}
.chart-edit-btn{display:none}`;
}

function exportHTML(title, content) {
  const out = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${esc(title)}</title>
<style>${exportCSS()}</style>
</head>
<body>
${content}
</body>
</html>`;
  blobDownload(safeName(title)+'.html','text/html;charset=utf-8', out);
}

function exportTXT(title, plain) {
  blobDownload(safeName(title)+'.txt','text/plain;charset=utf-8', plain);
}

function exportMD(title, html) {
  let md = html
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi,         (_,t)=>`# ${stripT(t)}\n\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi,         (_,t)=>`## ${stripT(t)}\n\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi,         (_,t)=>`### ${stripT(t)}\n\n`)
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, (_,t)=>`**${stripT(t)}**`)
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi,           (_,t)=>`**${stripT(t)}**`)
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi,         (_,t)=>`_${stripT(t)}_`)
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi,           (_,t)=>`_${stripT(t)}_`)
    .replace(/<u[^>]*>([\s\S]*?)<\/u>/gi,           (_,t)=>stripT(t))
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_,href,t)=>`[${stripT(t)}](${href})`)
    .replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, (_,src,alt)=>`![${alt}](${src})`)
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,   (_,t)=>`> ${stripT(t).trim()}\n\n`)
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi,      (_,t)=>'```\n'+stripT(t).trim()+'\n```\n\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi,         (_,t)=>`- ${stripT(t).trim()}\n`)
    .replace(/<ul[^>]*>|<\/ul>/gi,'\n')
    .replace(/<ol[^>]*>|<\/ol>/gi,'\n')
    .replace(/<hr\s*\/?>/gi,'\n---\n\n')
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<\/p>/gi,'\n\n')
    .replace(/<p[^>]*>/gi,'')
    .replace(/<!-- chart -->[\s\S]*?<!-- \/chart -->/gi,'[Chart — open HTML version to view]\n\n')
    .replace(/<[^>]+>/g,'')
    .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
    .replace(/\n{3,}/g,'\n\n').trim();
  blobDownload(safeName(title)+'.md','text/markdown;charset=utf-8', md);
}

function exportPDF(title, content) {
  // 1. Create a "ghost" container to process the content without affecting the editor
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = content;

  // 2. Locate all chart wrappers in the editor's content
  const chartWrappers = tempDiv.querySelectorAll('.doc-chart-wrap');
  
  chartWrappers.forEach(wrap => {
    const id = wrap.dataset.chartId;
    // We look for the ACTUAL canvas in the DOM to get the bitmap data
    const realCanvas = document.getElementById(id);
    if (realCanvas) {
      const img = document.createElement('img');
      img.src = realCanvas.toDataURL("image/png");
      img.style.width = "100%";
      img.style.height = "auto";
      img.style.display = "block";
      img.style.margin = "0 auto";
      
      // Replace the buttons/canvas inside the PDF ghost container with a standard image
      wrap.innerHTML = '';
      wrap.appendChild(img);
    }
  });

  const finalContent = tempDiv.innerHTML;

  const win = window.open('','_blank','width=960,height=760');
  if (!win) { toast('Pop-up blocked — allow pop-ups for this site.', true); return; }
  
  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${esc(title)}</title>
<style>
${exportCSS()}
.print-tip{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:1.5em;font-family:sans-serif;font-size:13px;color:#92400e}
.print-tip kbd{background:#fff;border:1px solid #ccc;border-radius:3px;padding:1px 6px;font-family:monospace}
@media print{.print-tip{display:none}body{margin:0;padding:20px 28px}}
</style>
</head>
<body>
<div class="print-tip">
  💡 Press <kbd>Ctrl+P</kbd> (Windows) or <kbd>⌘ Cmd+P</kbd> (Mac)
  → set destination to <strong>"Save as PDF"</strong> → click Save
</div>
${finalContent}
</body>
</html>`);
  win.document.close(); win.focus();
  setTimeout(()=>{ try{ win.print(); }catch(e){} }, 1000);
}

/* ═══════════════════════════════════════════════════
   PORTAL MENUS
═══════════════════════════════════════════════════ */
function toggleMenu(menuId, triggerEl) {
  const menu   = document.getElementById(menuId);
  const isOpen = !menu.classList.contains('hidden');
  closeMenus();
  if (isOpen) return;

  const rect  = triggerEl.getBoundingClientRect();
  const viewH = window.innerHeight;

  menu.style.top    = (rect.bottom + 4) + 'px';
  menu.style.bottom = '';
  menu.style.left   = rect.left + 'px';
  menu.classList.remove('hidden');

  const mr = menu.getBoundingClientRect();
  if (mr.right > window.innerWidth - 8)
    menu.style.left = (window.innerWidth - mr.width - 8) + 'px';

  if (rect.bottom + mr.height + 8 > viewH && rect.top > mr.height + 8) {
    menu.style.top    = '';
    menu.style.bottom = (viewH - rect.top + 4) + 'px';
  }
}

function closeMenus() {
  document.querySelectorAll('.portal-menu').forEach(m => {
    m.classList.add('hidden');
    m.style.top = m.style.bottom = m.style.left = '';
  });
}

document.addEventListener('click', e => {
  if (!e.target.closest('#insert-trigger,#export-trigger,.portal-menu')) closeMenus();
});

/* ═══════════════════════════════════════════════════
   SHARE
═══════════════════════════════════════════════════ */
function copyRoomId() {
  navigator.clipboard.writeText(state.roomId||'').then(()=>toast('Room ID copied!'));
}
function copyShareLink() {
  const link = location.origin + location.pathname + '?room=' + state.roomId;
  navigator.clipboard.writeText(link).then(()=>toast('Share link copied — recipient still needs the access code.'));
}

;(function() {
  const room = new URLSearchParams(location.search).get('room');
  if (room) { switchTab('join'); const el=document.getElementById('j-room'); if(el) el.value=room.toUpperCase(); }
})();

/* ═══════════════════════════════════════════════════
   RENDER USERS / ACTIVITY
═══════════════════════════════════════════════════ */
function renderUsers(users) {
  if (!users) return;
  state.activeUsers = {};
  (Array.isArray(users)?users:Object.values(users)).forEach(u=>{ state.activeUsers[u.userId]=u; });
  renderUsersBar(); renderCollabList();
}
function renderUsersBar() {
  const bar = document.getElementById('users-bar');
  const arr = Object.values(state.activeUsers);
  bar.innerHTML = arr.slice(0,6).map(u=>`
    <div class="user-dot" style="background:${u.color}">${u.name[0].toUpperCase()}
      <span class="user-tip">${u.name}${u.userId===state.userId?' (you)':''}</span>
    </div>`).join('');
  if (arr.length>6) bar.innerHTML+=`<div class="user-dot" style="background:#e5e7eb;color:#6b7280">+${arr.length-6}</div>`;
}
function renderCollabList() {
  const el = document.getElementById('collab-list');
  const arr = Object.values(state.activeUsers);
  el.innerHTML = arr.length
    ? arr.map(u=>`<div class="flex items-center gap-2">
        <div class="collab-avatar" style="background:${u.color}">${u.name[0].toUpperCase()}</div>
        <div>
          <p class="text-xs text-gray-700 font-medium leading-none">${u.name}${u.userId===state.userId?' <span class="text-gray-400 font-normal">(you)</span>':''}</p>
          <p class="text-[10px] text-gray-400 mt-0.5">Active now</p>
        </div></div>`).join('')
    : '<p class="text-xs text-gray-300">No active collaborators</p>';
}
function renderActivity(activity) {
  const el = document.getElementById('activity-log');
  el.innerHTML = activity&&activity.length
    ? activity.map(a=>`<div class="activity-item"><span class="actor">${a.user}</span> ${a.action}<time class="time">${timeAgo(a.timestamp)}</time></div>`).join('')
    : '<p class="text-xs text-gray-300">No activity yet</p>';
}

/* ═══════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════ */
function insertHTML(html) {
  getEd().focus();
  document.execCommand('insertHTML', false, html);
  onInput();
}
function saveCaret() {
  const sel=window.getSelection();
  if(sel&&sel.rangeCount) state.savedRange=sel.getRangeAt(0).cloneRange();
}
function restoreCaret() {
  if(!state.savedRange) return;
  const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(state.savedRange);
}
function updateCounts() {
  const txt=getEd().innerText||'';
  const w=txt.trim()?txt.trim().split(/\s+/).length:0;
  document.getElementById('word-count').textContent=`${w} word${w!==1?'s':''}`;
  document.getElementById('char-count').textContent=`${txt.length} chars`;
}
function setSaving(v) {
  const dot=document.getElementById('save-dot'),txt=document.getElementById('save-text');
  dot.style.background=v?'#f59e0b':'#10b981';
  dot.classList.toggle('saving-anim',v);
  txt.textContent=v?'Saving…':'Saved';
}
function setConn(on) {
  const dot=document.getElementById('conn-dot'),txt=document.getElementById('conn-text');
  if(!dot) return;
  dot.style.background=on?'#10b981':'#ef4444';
  txt.textContent=on?'Live':'Offline';
}
function toast(msg, isErr=false) {
  const t=document.getElementById('toast');
  t.textContent=msg;
  t.style.background=isErr?'#dc2626':'#111827';
  t.style.opacity='1'; t.style.transform='translateX(-50%) translateY(0)';
  setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateX(-50%) translateY(8px)'; },3000);
}
function loading(show,msg='Loading…') {
  document.getElementById('loading-overlay').classList.toggle('hidden',!show);
  document.getElementById('loading-text').textContent=msg;
}
function err(id,msg) { loading(false); const el=document.getElementById(id); el.textContent=msg; el.classList.remove('hidden'); }
function hide(id)    { document.getElementById(id).classList.add('hidden'); }
function v(id)       { return document.getElementById(id).value.trim(); }
function post(url,body){ return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); }
function esc(s)      { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function stripT(s)   { return (s||'').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim(); }
function timeAgo(ts) {
  const s=Math.floor((Date.now()-new Date(ts).getTime())/1000);
  if(s<5) return 'just now'; if(s<60) return `${s}s ago`;
  if(s<3600) return `${Math.floor(s/60)}m ago`;
  if(s<86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}
function getCursorPos() {
  const sel=window.getSelection(); if(!sel.rangeCount) return 0;
  const r=sel.getRangeAt(0).cloneRange();
  r.selectNodeContents(getEd()); r.setEnd(sel.getRangeAt(0).endContainer,sel.getRangeAt(0).endOffset);
  return r.toString().length;
}
function saveSel(el) {
  const sel=window.getSelection();
  if(!sel.rangeCount||!el.contains(sel.anchorNode)) return null;
  const r=sel.getRangeAt(0);
  return { start:textOff(el,r.startContainer,r.startOffset), end:textOff(el,r.endContainer,r.endOffset) };
}
function textOff(root,node,off) {
  let pos=0; const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  while(w.nextNode()){ if(w.currentNode===node) return pos+off; pos+=w.currentNode.length; }
  return pos;
}
function restoreSel(el,saved) {
  if(!saved) return;
  const sel=window.getSelection(), w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
  let pos=0,sN,eN,sO,eO;
  while(w.nextNode()){
    const len=w.currentNode.length;
    if(!sN&&pos+len>=saved.start){sN=w.currentNode;sO=saved.start-pos;}
    if(!eN&&pos+len>=saved.end){eN=w.currentNode;eO=saved.end-pos;break;}
    pos+=len;
  }
  if(!sN) return;
  try{ const r=document.createRange(); r.setStart(sN,sO); r.setEnd(eN||sN,eO??sO); sel.removeAllRanges(); sel.addRange(r); }catch{}
}
