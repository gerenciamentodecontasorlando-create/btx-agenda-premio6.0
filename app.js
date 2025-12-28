// app.js — BTX Premium Clean
// Foco: impressos limpos + profissional automático + agenda com dia visível + estabilidade

let deferredPrompt = null;

const LS = {
  proAtivo: "btx_clean_pro_ativo"
};

const RX_PRESETS = {
  "Odonto — Analgésico": [
    "Dipirona 500 mg — tomar 1 comprimido VO a cada 6/6h se dor, por 3 dias.",
    "Paracetamol 750 mg — tomar 1 comprimido VO a cada 8/8h, por 3 dias."
  ],
  "Odonto — Anti-inflamatório": [
    "Ibuprofeno 600 mg — tomar 1 comprimido VO a cada 8/8h após alimentação, por 3 dias.",
    "Naproxeno 500 mg — tomar 1 comprimido VO a cada 12/12h após alimentação, por 3 dias."
  ],
  "Odonto — Antibiótico": [
    "Amoxicilina 500 mg — tomar 1 cápsula VO a cada 8/8h por 7 dias.",
    "Amoxicilina + Clavulanato 875/125 mg — tomar 1 comprimido VO a cada 12/12h por 7 dias."
  ],
  "Clínica — HAS": [
    "Losartana 50 mg — tomar 1 comprimido VO 1x ao dia (conforme orientação médica).",
    "Hidroclorotiazida 25 mg — tomar 1 comprimido VO pela manhã 1x ao dia (conforme orientação médica)."
  ],
  "Clínica — Diabetes": [
    "Metformina 850 mg — tomar 1 comprimido VO após refeições 2x ao dia (conforme orientação médica).",
    "Glibenclamida 5 mg — tomar 1 comprimido VO antes do café 1x ao dia (conforme orientação médica)."
  ]
};

const state = {
  view: "agenda",
  profAtivoId: null,
  agendaDateISO: null,
  autosaveTimer: null
};

function $(id){ return document.getElementById(id); }
function safe(v){ return String(v ?? "").trim(); }
function uid(prefix="id"){ return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`; }

function todayISO(){
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off*60*1000);
  return local.toISOString().slice(0,10);
}
function isoToBR(iso){
  if(!iso) return "";
  const [y,m,d]=iso.split("-");
  return `${d}/${m}/${y}`;
}
function weekdayShort(d){
  return ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"][d];
}
function monthShort(m){
  return ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][m];
}

function toast(msg){
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(state._toastT);
  state._toastT = setTimeout(()=>t.classList.remove("show"), 2400);
}

function setView(name){
  state.view = name;
  document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
  document.querySelectorAll(".navItem").forEach(b=>b.classList.remove("active"));
  $(`view-${name}`).classList.remove("hidden");
  document.querySelector(`.navItem[data-view="${name}"]`)?.classList.add("active");
}

// ---------------- PROFISSIONAIS ----------------
async function loadProfissionais(){
  const pros = await idbAll(STORES.profissionais);
  pros.sort((a,b)=> (a.nome||"").localeCompare(b.nome||""));

  const sel = $("selProAtivo");
  sel.innerHTML = "";

  if (pros.length === 0){
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "— sem profissionais —";
    sel.appendChild(opt);
    state.profAtivoId = null;
    localStorage.removeItem(LS.proAtivo);
    return;
  }

  let ativo = localStorage.getItem(LS.proAtivo);
  if (!ativo || !pros.some(p=>p.id===ativo)) ativo = pros[0].id;

  state.profAtivoId = ativo;
  localStorage.setItem(LS.proAtivo, ativo);

  for (const p of pros){
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.nome || "(sem nome)";
    sel.appendChild(opt);
  }
  sel.value = ativo;
}

async function getProfAtivo(){
  const id = state.profAtivoId || localStorage.getItem(LS.proAtivo);
  if (!id) return null;
  return await idbGet(STORES.profissionais, id);
}

function proFormHTML(p={}){
  return `
    <div class="field"><label>Nome (Profissional / Clínica)</label><input id="pro_nome" class="input" value="${safe(p.nome)}" /></div>
    <div class="field"><label>Registro (CRO/CRM)</label><input id="pro_reg" class="input" value="${safe(p.registro)}" /></div>
    <div class="field"><label>Endereço</label><input id="pro_end" class="input" value="${safe(p.endereco)}" /></div>
    <div class="grid2">
      <div class="field"><label>Telefone</label><input id="pro_tel" class="input" value="${safe(p.telefone)}" /></div>
      <div class="field"><label>WhatsApp</label><input id="pro_wpp" class="input" value="${safe(p.whatsapp)}" /></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Cidade</label><input id="pro_cidade" class="input" value="${safe(p.cidade)}" /></div>
      <div class="field"><label>UF</label><input id="pro_uf" class="input" value="${safe(p.uf)}" /></div>
    </div>
  `;
}

// ---------------- MODAL ----------------
function modalOpen(title, bodyHTML, onOk){
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = bodyHTML;
  $("modal").classList.remove("hidden");

  const close = () => $("modal").classList.add("hidden");
  $("modalClose").onclick = close;
  $("modalCancel").onclick = close;

  $("modalOk").onclick = async () => {
    await onOk?.();
    close();
  };
}

// ---------------- AGENDA (por dia) ----------------
function addDays(iso, delta){
  const [y,m,d]=iso.split("-").map(Number);
  const dt = new Date(y, m-1, d);
  dt.setDate(dt.getDate()+delta);
  const off = dt.getTimezoneOffset();
  const local = new Date(dt.getTime() - off*60*1000);
  return local.toISOString().slice(0,10);
}

function agendaId(profId, dataISO){
  return `agenda_${profId}_${dataISO}`;
}

async function getAgendaDay(profId, dataISO){
  const id = agendaId(profId, dataISO);
  return await idbGet(STORES.agenda, id) || { id, profId, dataISO, itens: [] };
}
async function saveAgendaDay(doc){
  await idbPut(STORES.agenda, doc);
}

function renderBigDate(dataISO){
  const [y,m,d]=dataISO.split("-").map(Number);
  const dt = new Date(y, m-1, d);
  const txt = `${weekdayShort(dt.getDay())}, ${String(d).padStart(2,"0")} ${monthShort(dt.getMonth())} ${y}`;
  $("agendaBigDate").textContent = txt;
}

function renderWeekStrip(centerISO){
  const pills = [];
  for (let i=-3;i<=3;i++){
    const iso = addDays(centerISO, i);
    const [y,m,d]=iso.split("-").map(Number);
    const dt = new Date(y, m-1, d);
    const label = `${weekdayShort(dt.getDay())} ${String(d).padStart(2,"0")}`;
    pills.push({ iso, label });
  }
  const wrap = $("agendaWeek");
  wrap.innerHTML = "";
  for (const p of pills){
    const el = document.createElement("div");
    el.className = "dayPill" + (p.iso===centerISO ? " active":"");
    el.textContent = p.label;
    el.onclick = async ()=> {
      state.agendaDateISO = p.iso;
      $("agendaDate").value = p.iso;
      await renderAgenda();
    };
    wrap.appendChild(el);
  }
}

async function renderAgenda(){
  const prof = await getProfAtivo();
  renderBigDate(state.agendaDateISO);
  renderWeekStrip(state.agendaDateISO);

  if (!prof){
    $("agendaList").innerHTML = `<div class="muted">Crie e selecione um profissional para usar a agenda.</div>`;
    $("agendaStats").textContent = "";
    return;
  }

  const day = await getAgendaDay(prof.id, state.agendaDateISO);
  const list = $("agendaList");
  list.innerHTML = "";

  if (!day.itens.length){
    list.innerHTML = `<div class="muted">Sem agendamentos para ${isoToBR(day.dataISO)}.</div>`;
  } else {
    day.itens.sort((a,b)=> (a.hora||"").localeCompare(b.hora||""));
    for (const it of day.itens){
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="t">${safe(it.hora)} — ${safe(it.paciente)}</div>
        <div class="m">${safe(it.servico)} • ${safe(it.status || "confirmado")}</div>
        ${it.obs ? `<div class="m">${safe(it.obs)}</div>` : ``}
        <div class="actions">
          <button class="btn ghost" data-edit="${it.id}">Editar</button>
          <button class="btn ghost" data-del="${it.id}">Excluir</button>
        </div>
      `;
      list.appendChild(div);
    }
  }

  const total = day.itens.length;
  const confirmados = day.itens.filter(x=> (x.status||"")==="confirmado").length;
  $("agendaStats").textContent = `${prof.nome || ""} • ${isoToBR(day.dataISO)} • Total: ${total} • Confirmados: ${confirmados}`;

  list.querySelectorAll("[data-del]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-del");
      day.itens = day.itens.filter(x=>x.id!==id);
      await saveAgendaDay(day);
      toast("Agendamento removido.");
      renderAgenda();
    };
  });
  list.querySelectorAll("[data-edit]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-edit");
      const it = day.itens.find(x=>x.id===id);
      agendaModal(it, async (updated)=>{
        Object.assign(it, updated);
        await saveAgendaDay(day);
        toast("Agendamento atualizado.");
        renderAgenda();
      });
    };
  });
}

function agendaModal(it={}, onSave){
  modalOpen("Agendamento", `
    <div class="grid2">
      <div class="field"><label>Hora</label><input id="ag_hora" class="input" value="${safe(it.hora)}" placeholder="08:30" /></div>
      <div class="field"><label>Status</label>
        <select id="ag_status">
          <option value="confirmado">confirmado</option>
          <option value="pendente">pendente</option>
          <option value="faltou">faltou</option>
          <option value="remarcou">remarcou</option>
          <option value="realizado">realizado</option>
        </select>
      </div>
    </div>
    <div class="field"><label>Paciente</label><input id="ag_paciente" class="input" value="${safe(it.paciente)}" /></div>
    <div class="field"><label>Serviço</label><input id="ag_servico" class="input" value="${safe(it.servico)}" placeholder="Avaliação / Restauração / Próteses..." /></div>
    <div class="field"><label>Observações</label><input id="ag_obs" class="input" value="${safe(it.obs)}" /></div>
  `, async ()=>{
    const updated = {
      id: it.id || uid("ag"),
      hora: safe($("ag_hora").value),
      status: safe($("ag_status").value),
      paciente: safe($("ag_paciente").value),
      servico: safe($("ag_servico").value),
      obs: safe($("ag_obs").value),
    };
    await onSave(updated);
  });

  $("ag_status").value = it.status || "confirmado";
}

// ---------------- RECEITA ----------------
function fillRx(){
  const cats = Object.keys(RX_PRESETS);
  $("rxCategoria").innerHTML = cats.map(c=>`<option>${c}</option>`).join("");
  fillRxModel();
}
function fillRxModel(){
  const cat = $("rxCategoria").value;
  const arr = RX_PRESETS[cat] || [];
  $("rxModelo").innerHTML = arr.map((txt,i)=>`<option value="${i}">Opção ${i+1}</option>`).join("");
}
function rxAddLine(){
  const t = $("rxTexto");
  const lines = t.value.trim()? t.value.trim().split("\n").filter(Boolean).length : 0;
  t.value = (t.value.trim()? t.value.trim()+"\n":"") + `${lines+1}. `;
}
function rxApply(){
  const cat = $("rxCategoria").value;
  const i = Number($("rxModelo").value || 0);
  const txt = (RX_PRESETS[cat] || [])[i];
  if (!txt) return;
  const t = $("rxTexto");
  const base = t.value.trim() ? t.value.trim() + "\n" : "";
  const next = base ? base.split("\n").filter(Boolean).length + 1 : 1;
  t.value = `${base}${next}. ${txt}\n`;
}

// ---------------- FICHA (autosave) ----------------
function pacienteKey(nome){
  return safe(nome).toLowerCase().replace(/\s+/g,"_").slice(0,60) || "paciente";
}
function fichaId(profId, dataISO, pacNome){
  return `ficha_${profId}_${dataISO}_${pacienteKey(pacNome)}`;
}

async function fichaSave(silent=false){
  const prof = await getProfAtivo();
  if (!prof){ if(!silent) toast("Selecione um profissional."); return; }

  const paciente = safe($("fiPaciente").value);
  const dataISO = $("fiData").value || todayISO();
  const doc = {
    id: fichaId(prof.id, dataISO, paciente),
    profId: prof.id,
    dataISO,
    paciente,
    pacienteKey: pacienteKey(paciente),
    anamnese: $("fiAnamnese").value || "",
    exame: $("fiExame").value || "",
    plano: $("fiPlano").value || "",
    updatedAt: Date.now()
  };
  await idbPut(STORES.fichas, doc);
  $("fiStatus").textContent = `Salvo em ${new Date().toLocaleString()}`;
  if (!silent) toast("Ficha salva.");
}

function fichaAutosave(){
  clearInterval(state.autosaveTimer);
  state.autosaveTimer = setInterval(()=>fichaSave(true), 8000);
}

// ---------------- IMPRESSOS (JANELA LIMPA) ----------------
// Aqui é onde garantimos que NADA da UI vai parar no PDF: a janela é construída do zero.
function printWindow(html, title="Documento"){
  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w){
    toast("Bloqueio de pop-up: permita abrir janela para imprimir.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.document.title = title;

  // espera renderizar antes de printar
  setTimeout(()=>{
    w.focus();
    w.print();
  }, 350);
}

function docShell({contentHTML, extraCSS=""}){
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  *{ box-sizing:border-box; }
  body{ margin:0; background:#fff; color:#111; font-family: Arial, sans-serif; }
  .page{ width: 210mm; min-height: 297mm; padding: 18mm 16mm; margin: 0 auto; }
  .hdr{ display:flex; gap:12px; align-items:flex-start; }
  .btx{ font-weight:900; border:1px solid #111; border-radius:10px; padding:6px 10px; }
  .h1{ font-size:16px; font-weight:900; margin:0 0 2px 0; }
  .muted{ font-size:12px; color:#333; line-height:1.35; }
  .sep{ border-top:1px solid #bbb; margin:14px 0; }
  .meta{ display:flex; justify-content:space-between; gap:12px; font-size:12px; }
  .title{ text-align:center; font-weight:900; letter-spacing:1px; margin:14px 0; }
  .body{ font-size:13px; line-height:1.6; white-space:pre-wrap; }
  .footer{ margin-top:22px; font-size:12px; }
  .sign{ margin-top:26px; border-top:1px solid #111; width: 70mm; }
  @page{ size: A4; margin: 0; }
  @media print{
    .page{ padding: 18mm 16mm; }
  }
  ${extraCSS}
</style>
</head>
<body>
  <div class="page">
    ${contentHTML}
  </div>
</body>
</html>`;
}

function renderHeader(prof){
  const contato = [prof?.telefone ? `Tel: ${prof.telefone}`:"", prof?.whatsapp ? `WhatsApp: ${prof.whatsapp}`:""].filter(Boolean).join(" • ");
  const reg = prof?.registro ? `Registro: ${prof.registro}` : "";
  return `
    <div class="hdr">
      <div class="btx">BTX</div>
      <div>
        <div class="h1">${safe(prof?.nome)}</div>
        ${reg ? `<div class="muted">${reg}</div>`:""}
        ${prof?.endereco ? `<div class="muted">${safe(prof.endereco)}</div>`:""}
        ${contato ? `<div class="muted">${contato}</div>`:""}
      </div>
    </div>
  `;
}

async function printReceita(){
  const prof = await getProfAtivo();
  if (!prof){ toast("Selecione um profissional."); return; }

  const paciente = safe($("rxPaciente").value);
  const dataISO = $("rxData").value || todayISO();
  const prescricao = safe($("rxTexto").value);

  if (!paciente || !prescricao){
    toast("Preencha paciente e prescrição.");
    return;
  }

  const cidadeUF = [prof.cidade, prof.uf].filter(Boolean).join(" - ");
  const localData = cidadeUF ? `${cidadeUF}, ${isoToBR(dataISO)}` : isoToBR(dataISO);
  const ass = [prof.nome, prof.registro ? `Registro: ${prof.registro}`:""].filter(Boolean).join(" — ");

  const content = `
    ${renderHeader(prof)}
    <div class="sep"></div>
    <div class="meta">
      <div><strong>Paciente:</strong> ${paciente}</div>
      <div><strong>Data:</strong> ${isoToBR(dataISO)}</div>
    </div>
    <div class="title">RECEITUÁRIO</div>
    <div class="body">${prescricao.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
    <div class="footer">
      <div class="muted">${localData}</div>
      <div class="sign"></div>
      <div class="muted">${ass}</div>
    </div>
  `;

  printWindow(docShell({contentHTML: content}), `Receita - ${paciente}`);
}

async function printAtestado(){
  const prof = await getProfAtivo();
  if (!prof){ toast("Selecione um profissional."); return; }

  const paciente = safe($("atPaciente").value);
  const dataISO = $("atData").value || todayISO();
  const dias = safe($("atDias").value);
  const cid = safe($("atCID").value);
  const texto = safe($("atTexto").value);

  if (!paciente){
    toast("Preencha o paciente.");
    return;
  }

  const cidadeUF = [prof.cidade, prof.uf].filter(Boolean).join(" - ");
  const localData = cidadeUF ? `${cidadeUF}, ${isoToBR(dataISO)}` : isoToBR(dataISO);
  const ass = [prof.nome, prof.registro ? `Registro: ${prof.registro}`:""].filter(Boolean).join(" — ");

  const body = texto || `Atesto para os devidos fins que ${paciente} necessita de afastamento de ${dias || "___"} dia(s), a contar de ${isoToBR(dataISO)}.${cid ? ` CID: ${cid}.`:""}`;

  const content = `
    ${renderHeader(prof)}
    <div class="sep"></div>
    <div class="meta">
      <div><strong>Paciente:</strong> ${paciente}</div>
      <div><strong>Data:</strong> ${isoToBR(dataISO)}</div>
    </div>
    <div class="title">ATESTADO</div>
    <div class="body">${body.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
    <div class="footer">
      <div class="muted">${localData}</div>
      <div class="sign"></div>
      <div class="muted">${ass}</div>
    </div>
  `;

  printWindow(docShell({contentHTML: content}), `Atestado - ${paciente}`);
}

async function printFicha(){
  const prof = await getProfAtivo();
  if (!prof){ toast("Selecione um profissional."); return; }

  const paciente = safe($("fiPaciente").value);
  const dataISO = $("fiData").value || todayISO();

  if (!paciente){
    toast("Preencha o paciente.");
    return;
  }

  const cidadeUF = [prof.cidade, prof.uf].filter(Boolean).join(" - ");
  const localData = cidadeUF ? `${cidadeUF}, ${isoToBR(dataISO)}` : isoToBR(dataISO);
  const ass = [prof.nome, prof.registro ? `Registro: ${prof.registro}`:""].filter(Boolean).join(" — ");

  const an = safe($("fiAnamnese").value);
  const ex = safe($("fiExame").value);
  const pl = safe($("fiPlano").value);

  const content = `
    ${renderHeader(prof)}
    <div class="sep"></div>
    <div class="meta">
      <div><strong>Paciente:</strong> ${paciente}</div>
      <div><strong>Data:</strong> ${isoToBR(dataISO)}</div>
    </div>
    <div class="title">FICHA CLÍNICA</div>
    <div class="body"><strong>Anamnese:</strong>\n${an}\n\n<strong>Exame / Achados:</strong>\n${ex}\n\n<strong>Plano / Conduta:</strong>\n${pl}</div>
    <div class="footer">
      <div class="muted">${localData}</div>
      <div class="sign"></div>
      <div class="muted">${ass}</div>
    </div>
  `;

  printWindow(docShell({contentHTML: content}), `Ficha - ${paciente}`);
}

async function printAgendaDia(){
  const prof = await getProfAtivo();
  if (!prof){ toast("Selecione um profissional."); return; }

  const day = await getAgendaDay(prof.id, state.agendaDateISO);
  const cidadeUF = [prof.cidade, prof.uf].filter(Boolean).join(" - ");
  const localData = cidadeUF ? `${cidadeUF}, ${isoToBR(day.dataISO)}` : isoToBR(day.dataISO);

  const itens = (day.itens || []).slice().sort((a,b)=> (a.hora||"").localeCompare(b.hora||""));
  const lines = itens.length
    ? itens.map((it,i)=> `${String(i+1).padStart(2,"0")}. ${safe(it.hora)} — ${safe(it.paciente)} • ${safe(it.servico)} • ${safe(it.status||"")}${it.obs?` • ${safe(it.obs)}`:""}`).join("\n")
    : "Sem agendamentos.";

  const content = `
    ${renderHeader(prof)}
    <div class="sep"></div>
    <div class="meta">
      <div><strong>Agenda do dia</strong></div>
      <div><strong>Data:</strong> ${isoToBR(day.dataISO)}</div>
    </div>
    <div class="title">AGENDA</div>
    <div class="body">${lines.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
    <div class="footer">
      <div class="muted">${localData}</div>
    </div>
  `;

  printWindow(docShell({contentHTML: content}), `Agenda - ${isoToBR(day.dataISO)}`);
}

// ---------------- BACKUP / RESTORE ----------------
async function backupJSON(){
  const profissionais = await idbAll(STORES.profissionais);
  const agenda = await idbAll(STORES.agenda);
  const fichas = await idbAll(STORES.fichas);

  const payload = {
    app: "BTX Premium Clean",
    exportedAt: new Date().toISOString(),
    profissionais, agenda, fichas
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `btx_clean_backup_${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Backup gerado.");
}

async function restoreJSON(file){
  const txt = await file.text();
  const data = JSON.parse(txt);
  if (!data || !Array.isArray(data.profissionais)) throw new Error("Backup inválido.");

  for (const p of data.profissionais) await idbPut(STORES.profissionais, p);
  for (const d of (data.agenda||[])) await idbPut(STORES.agenda, d);
  for (const f of (data.fichas||[])) await idbPut(STORES.fichas, f);

  toast("Backup restaurado.");
  await loadProfissionais();
  await renderAgenda();
}

// ---------------- INIT ----------------
async function init(){
  // PWA install
  window.addEventListener("beforeinstallprompt", (e)=>{
    e.preventDefault();
    deferredPrompt = e;
    $("btnInstall").classList.remove("ghost");
  });

  $("btnInstall").onclick = async ()=>{
    if (!deferredPrompt){ toast("Instalação indisponível agora."); return; }
    deferredPrompt.prompt();
    deferredPrompt = null;
  };

  // NAV
  document.querySelectorAll(".navItem").forEach(btn=>{
    btn.onclick = ()=> setView(btn.dataset.view);
  });

  // Profissionais
  await loadProfissionais();

  $("selProAtivo").onchange = async (e)=>{
    state.profAtivoId = e.target.value || null;
    localStorage.setItem(LS.proAtivo, state.profAtivoId || "");
    toast("Profissional ativo definido.");
    await renderAgenda();
  };

  $("btnNewPro").onclick = ()=>{
    modalOpen("Novo profissional", proFormHTML({}), async ()=>{
      const pro = {
        id: uid("pro"),
        nome: safe($("pro_nome").value),
        registro: safe($("pro_reg").value),
        endereco: safe($("pro_end").value),
        telefone: safe($("pro_tel").value),
        whatsapp: safe($("pro_wpp").value),
        cidade: safe($("pro_cidade").value),
        uf: safe($("pro_uf").value),
        createdAt: Date.now()
      };
      await idbPut(STORES.profissionais, pro);
      toast("Profissional criado.");
      await loadProfissionais();
      await renderAgenda();
    });
  };

  $("btnManagePro").onclick = async ()=>{
    const pros = await idbAll(STORES.profissionais);
    if (!pros.length){ toast("Sem profissionais."); return; }

    const list = pros.map(p=>`
      <div class="item">
        <div class="t">${safe(p.nome) || "(sem nome)"}</div>
        <div class="m">${safe(p.registro)} • ${safe(p.telefone)} • ${safe(p.whatsapp)}</div>
        <div class="actions">
          <button class="btn ghost" data-edit="${p.id}">Editar</button>
          <button class="btn ghost" data-del="${p.id}">Excluir</button>
        </div>
      </div>
    `).join("");

    modalOpen("Gerenciar profissionais", `<div class="list">${list}</div>`, async ()=>{});

    $("modalBody").querySelectorAll("[data-edit]").forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute("data-edit");
        const pro = await idbGet(STORES.profissionais, id);
        modalOpen("Editar profissional", proFormHTML(pro), async ()=>{
          pro.nome = safe($("pro_nome").value);
          pro.registro = safe($("pro_reg").value);
          pro.endereco = safe($("pro_end").value);
          pro.telefone = safe($("pro_tel").value);
          pro.whatsapp = safe($("pro_wpp").value);
          pro.cidade = safe($("pro_cidade").value);
          pro.uf = safe($("pro_uf").value);
          pro.updatedAt = Date.now();
          await idbPut(STORES.profissionais, pro);
          toast("Atualizado.");
          await loadProfissionais();
          await renderAgenda();
        });
      };
    });

    $("modalBody").querySelectorAll("[data-del]").forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute("data-del");
        await idbDel(STORES.profissionais, id);
        toast("Excluído.");
        await loadProfissionais();
        await renderAgenda();
        $("modal").classList.add("hidden");
      };
    });
  };

  // Agenda
  state.agendaDateISO = todayISO();
  $("agendaDate").value = state.agendaDateISO;

  $("agendaDate").onchange = async (e)=>{
    state.agendaDateISO = e.target.value || todayISO();
    await renderAgenda();
  };

  $("btnPrevDay").onclick = async ()=>{
    state.agendaDateISO = addDays(state.agendaDateISO, -1);
    $("agendaDate").value = state.agendaDateISO;
    await renderAgenda();
  };
  $("btnNextDay").onclick = async ()=>{
    state.agendaDateISO = addDays(state.agendaDateISO, +1);
    $("agendaDate").value = state.agendaDateISO;
    await renderAgenda();
  };

  $("btnAgendar").onclick = async ()=>{
    const prof = await getProfAtivo();
    if (!prof){ toast("Selecione um profissional."); return; }
    const day = await getAgendaDay(prof.id, state.agendaDateISO);

    agendaModal({}, async (it)=>{
      day.itens.push(it);
      await saveAgendaDay(day);
      toast("Agendado.");
      renderAgenda();
    });
  };

  $("btnAgendaPrint").onclick = printAgendaDia;

  // Receita
  $("rxData").value = todayISO();
  fillRx();
  $("rxCategoria").onchange = fillRxModel;
  $("btnRxApply").onclick = rxApply;
  $("btnRxAddLine").onclick = rxAddLine;
  $("btnRxClear").onclick = ()=>{ $("rxTexto").value=""; toast("Receita limpa."); };
  $("btnRxPrint").onclick = printReceita;

  // Atestado
  $("atData").value = todayISO();
  $("btnAtClear").onclick = ()=>{
    $("atTexto").value = "";
    $("atDias").value = "";
    $("atCID").value = "";
    toast("Atestado limpo.");
  };
  $("btnAtPrint").onclick = printAtestado;

  // Ficha
  $("fiData").value = todayISO();
  fichaAutosave();
  $("btnFichaSave").onclick = ()=>fichaSave(false);
  $("btnFichaPrint").onclick = printFicha;

  ["fiPaciente","fiData","fiAnamnese","fiExame","fiPlano"].forEach(id=>{
    $(id).addEventListener("input", ()=> $("fiStatus").textContent = "Editando… autosave ligado.");
  });

  // Backup/Restore
  $("btnBackup").onclick = backupJSON;
  $("fileRestore").onchange = async (e)=>{
    const f = e.target.files?.[0];
    if (!f) return;
    try{ await restoreJSON(f); }
    catch(err){ console.error(err); toast("Falha ao restaurar backup."); }
    finally{ e.target.value=""; }
  };

  // SW
  if ("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  }

  setView("agenda");
  await renderAgenda();
}

init();
