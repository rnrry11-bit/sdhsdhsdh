/* 학생 화면
   화면 틀은 한 번만 만들고, 바뀐 부분만 다시 그려서 깜빡이지 않게 합니다. */
const app = document.getElementById('app');
const St = { token: lsGet('dc_token'), state: null, es: null, busy: false, seenSeq: null, draft: '', draftQ: null, joining: false,
  screen: '', bubbleSeq: 0, bubbleUntil: 0 };
const HERO_ICON = () => iconURL('hero', SPR.hero, { b: '#3557b0', c: '#f5c542' });
const TEACHER_ICON = () => iconURL('teacher', SPR.teacher, TEACHER_PAL);
const $ = id => document.getElementById(id);

/* ---------- 연결 ---------- */
function connect() {
  if (St.es) St.es.close();
  const es = new EventSource('/events?role=student&token=' + encodeURIComponent(St.token || ''));
  St.es = es;
  es.onmessage = e => {
    const m = JSON.parse(e.data); clockOffset = m.now - Date.now(); St.state = m.d; setConn(true);
    if (St.token && !m.d.me) { St.token = null; lsSet('dc_token', null); } // 서버가 초기화됨
    render();
  };
  es.onerror = () => setConn(false);
}
function setConn(ok) {
  let el = document.querySelector('.conn');
  if (ok) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.className = 'conn'; el.textContent = '연결이 끊겼어요. 다시 연결하는 중…'; document.body.appendChild(el); }
}
async function act(body) {
  if (St.busy) return; St.busy = true; render();
  const r = await post('/api/act', Object.assign({ token: St.token }, body));
  if (r.error) toast(r.error);
  St.busy = false; render();
}
// 1초마다: 시계, 재도전 대기, 말풍선 시간 처리 (바뀐 것만 다시 그림)
setInterval(() => {
  document.querySelectorAll('[data-clock]').forEach(el => { const t = mmss(remainingOf(St.state?.cfg)); if (el.textContent !== t) el.textContent = t; });
  if (St.screen === 'game') renderGame();
}, 250);

/* ---------- 화면 고르기 ---------- */
function render() {
  const d = St.state; if (!d) return;
  let screen = !d.me ? 'join' : !d.group ? 'wait' : d.cfg.status === 'lobby' ? 'lobby' : 'game';
  if (screen !== St.screen) { St.screen = screen; buildScreen(screen); }
  if (screen === 'lobby') renderLobby();
  if (screen === 'game') renderGame();
  setHTML($('ov'), d.cfg.status === 'paused' && d.group ? `<div class="overlay"><div class="box col center"><h2>잠시 멈춤</h2><p class="muted">선생님 설명을 들어 주세요.</p></div></div>` : '');
}
function buildScreen(s) {
  app._h = null;
  if (s === 'join') {
    app.innerHTML = `
    <section class="hero">
      <div class="col">
        <p class="kicker">국어 · 문장 성분 원정</p>
        <h1>용에게 잡혀간 선생님을 구하라</h1>
        <p class="muted">20층 성을 오르며 층마다 몬스터가 내는 문장 성분 문제를 풀어 물리치세요. 틀리면 공격을 받고, 10초 뒤 같은 문제에 다시 도전해요.</p>
      </div>
      <canvas id="cv" width="${SW}" height="${SH}" class="pixelimg" aria-label="용과 감옥에 갇힌 선생님"></canvas>
    </section>
    <form class="box col" id="joinf">
      <h3>원정대 등록</h3>
      <label class="f" for="nick">번호와 이름<input type="text" id="nick" maxlength="16" placeholder="예: 12번 김민지" autocomplete="off" required></label>
      <button class="btn" type="submit" id="joinbtn">성에 입장하기</button>
      <p class="muted" style="font-size:13px">입장한 순서대로 모둠이 정해져요.</p>
    </form>`;
    mountScene($('cv'), 20, 'ready', 20);
  } else if (s === 'wait') {
    app.innerHTML = `<div class="box center col" style="padding:32px 16px"><h2>모둠을 배정하는 중…</h2></div>`;
  } else if (s === 'lobby') {
    app.innerHTML = `<section class="box col" id="lobbyhead"></section>
      <canvas id="cv" width="${SW}" height="${SH}" class="pixelimg" style="width:100%;border:3px solid var(--line)" aria-label="성 1층"></canvas>
      <section class="box col" id="rules"></section>`;
    mountScene($('cv'), 1, 'ready', 20);
  } else if (s === 'game') {
    app.innerHTML = `
    <div class="box tight topbar" id="hud"></div>
    <div id="notice"></div>
    <div class="arena">
      <div class="scene" id="scene">
        <canvas id="cv" width="${SW}" height="${SH}" class="pixelimg" aria-label="전투 장면"></canvas>
        <div class="hpfloat" id="hpfloat"></div>
        <div id="montag"></div>
        <div class="bubble mon" id="monb" hidden></div>
        <div class="bubble hero" id="herob" hidden></div>
      </div>
      <div class="dialog" id="dialog" aria-live="polite"></div>
    </div>
    <div class="items" id="items"></div>
    <div class="box tight col" id="team"></div>
    <div class="log" id="log"></div>
    <details class="box tight map"><summary>성 지도 보기</summary><div class="tower" id="tower" aria-label="성 지도"></div></details>`;
    mountScene($('cv'), 1, 'ready', 20);
    St.seenSeq = null;
  }
}

/* ---------- 입장 / 대기실 ---------- */
app.addEventListener('submit', async e => {
  if (e.target.id === 'joinf') {
    e.preventDefault(); if (St.joining) return;
    const name = $('nick').value.trim(); if (!name) return;
    St.joining = true; $('joinbtn').disabled = true;
    const r = await post('/api/join', { name });
    St.joining = false;
    if (r.error || !r.token) { toast(r.error || '입장하지 못했어요. 다시 시도해 주세요.'); $('joinbtn').disabled = false; return; }
    St.token = r.token; lsSet('dc_token', r.token); connect();
  }
  if (e.target.id === 'ansf') {
    e.preventDefault(); const g = St.state.group; const v = $('answer').value.trim(); if (!v || !g.q) return;
    St.draft = ''; act({ type: 'answer', qid: g.q.id, text: v });
  }
});
app.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  const g = St.state?.group; if (!g) return;
  if (b.dataset.opt != null) act({ type: 'answer', qid: g.q.id, choice: +b.dataset.opt });
  else if (b.dataset.act) act({ type: b.dataset.act, floor: g.floor });
  else if (b.dataset.item) act({ type: 'item', item: b.dataset.item });
  else if (b.id === 'takeover') act({ type: 'takeover' });
});
app.addEventListener('input', e => { if (e.target.id === 'answer') St.draft = e.target.value; });

function memberChips(g) {
  return `<div class="members">${(g.members || []).map(m => `<span class="${m.me ? 'me' : ''} ${m.turn && St.state.cfg.turnMode ? 'now' : ''}">${esc(m.name)}${m.me ? ' (나)' : ''}</span>`).join('')}</div>`;
}
function renderLobby() {
  const d = St.state, g = d.group, c = d.cfg;
  setHTML($('lobbyhead'), `<p class="kicker">${g.no}모둠 배정 완료</p><h2>${esc(d.me.name)}, 원정대에 합류했어요</h2>${memberChips(g)}<p class="muted">선생님이 시작하면 1층 문이 열려요. 기다리는 동안 규칙을 확인하세요.</p>`);
  setHTML($('rules'), `<h3>원정 규칙</h3>
    <div class="col" style="gap:6px;font-size:14px">
      <p>👾 층마다 몬스터가 문제를 내요. 맞히면 몬스터를 물리치고 다음 층으로 올라가요.</p>
      <p>❤️ 모둠 체력은 100. 틀리면 몬스터의 공격력만큼 깎이고, <b>10초 뒤 같은 문제</b>에 다시 도전해요. (공격력 1~5층 3 · 6~11층 5 · 12~16층 10 · 17~19층 15 · 용 20)</p>
      <p>✍️ 버튼을 고르는 객관식과 답을 직접 쓰는 단답형이 섞여 나와요. 단답형은 띄어쓰기와 문장 부호를 신경 쓰지 않아도 돼요.</p>
      ${c.turnMode ? '<p>🔁 문제는 모둠원이 돌아가며 풀어요. 내 차례가 아니어도 함께 의논하세요.</p>' : ''}
      <p>🎁 5층, 10층, 15층 보물 상자에서 회복 물약(체력 +10), 현자의 힌트, 수호의 방패를 얻어요.</p>
      <p>🪤 덫을 밟으면 체력 ${c.trapDmg}이 깎이고, 치료 문제를 맞히면 ${c.trapHeal} 회복해요.</p>
      <p>💀 쓰러지면 ${c.respawn === 'checkpoint' ? '마지막 보물 층 다음 층' : '1층'}부터 다시 시작해요.</p>
      <p>🐉 20층 용은 ${c.dragonHp}번 맞혀야 쓰러져요. 그런데 성 꼭대기에는 무언가 더 있다는 소문이…</p>
    </div>`);
}

/* ---------- 게임 ---------- */
function monLine(g, m, locked) {
  const f = g.floor, final = f === g.maxFloor;
  if (g.phase === 'ready') return '들어올 테면 들어와 봐라!';
  if (g.phase === 'trap') return null;
  if (g.phase === 'won') return '크아악… 내가 지다니…';
  if (g.phase === 'dead') return `하하하! ${g.respawnFloor}층부터 다시 올라와라!`;
  if (g.phase === 'twist') return '후후후… 그 용은 내 부하였을 뿐.';
  if (g.phase === 'cleared') return null;
  if (g.phase !== 'fight') return null;
  if (locked) return '틀렸다! 10초 뒤에 다시 덤벼라!';
  if (g.ev?.type === 'hit') return '크윽… 아직 끝나지 않았다! 다음 문제다!';
  if (f === 20) return '감히 여기까지 오다니! 내 문제를 풀어 봐라!';
  if (f > 20 && final) return '후후… 내 문제를 풀 수 있겠느냐?';
  return `나는 ${f}층의 ${m.n}! 이 문제를 풀어 봐라!`;
}
function renderGame() {
  const d = St.state, g = d.group, c = d.cfg; if (!g || !$('dialog')) return;
  const f = g.floor, m = monFor(f, g.maxFloor), now = serverNow();
  const live = c.status === 'playing';
  const locked = (g.lockUntil || 0) > now;
  const top = g.maxFloor || 20;

  // 장면
  scene.floor = f; scene.phase = g.phase; scene.maxFloor = top;
  const seq = g.ev?.seq || 0;
  if (St.seenSeq == null) St.seenSeq = seq;
  else if (seq !== St.seenSeq) {
    if (seq > St.seenSeq) { playEvent(g.ev); if (g.lastAns && g.lastAns.seq === seq) { St.bubbleSeq = seq; St.bubbleUntil = Date.now() + 3500; } }
    St.seenSeq = seq;
  }

  // 위쪽 정보
  setHTML($('hud'), `<span class="pill gold">${g.no}모둠</span><span class="px">${f}F / ${top}F</span>
    ${f > 20 ? '<span class="pill" style="background:#3a1f5e">흑막의 탑</span>' : ''}${g.shieldOn ? '<span class="pill sky">방패 준비</span>' : ''}
    <span class="spacer"></span><span class="px" style="color:var(--gold)" data-clock>${mmss(remainingOf(c))}</span>`);
  setHTML($('notice'), c.notice ? `<div class="note">📢 선생님: ${esc(c.notice)}</div>` : '');
  setHTML($('hpfloat'), `<span class="tag">원정대 ${g.no}모둠</span><div class="hpbar ${hpClass(g.hp)}" role="meter" aria-valuenow="${g.hp}" aria-valuemin="0" aria-valuemax="100" aria-label="체력"><i style="width:${g.hp}%"></i><b>HP ${g.hp}</b></div>`);
  const showMon = ['fight', 'ready', 'dead'].includes(g.phase);
  const bossHp = (f === 20 || (f > 20 && f === top)) && g.phase === 'fight';
  setHTML($('montag'), showMon ? `<div class="mon-tag">${esc(m.n)} <span class="px">ATK ${DMG(f, top)}</span></div>${bossHp ? `<div class="mhp">${Array.from({ length: c.dragonHp }, (_, i) => `<i class="${i >= g.mhp ? 'gone' : ''}"></i>`).join('')}</div>` : ''}` : '');

  // 말풍선
  const ml = monLine(g, m, locked); const mb = $('monb');
  setHTML(mb, ml ? esc(ml) : ''); mb.hidden = !ml;
  const hb = $('herob'); const la = g.lastAns;
  let heroText = null, heroCls = '';
  if (la && St.bubbleSeq === la.seq && Date.now() < St.bubbleUntil) { heroText = `${la.name}: “${la.text}”`; heroCls = la.ok ? 'ok' : 'bad'; }
  else if (g.phase === 'trap') heroText = '앗, 가시 덫이다!';
  else if (g.phase === 'cleared') heroText = '선생님, 구하러 왔어요!';
  else if (g.phase === 'treasure') heroText = '보물 상자다!';
  setHTML(hb, heroText ? esc(heroText) : ''); hb.hidden = !heroText;
  const hcls = 'bubble hero ' + heroCls; if (hb.className !== hcls) hb.className = hcls;

  // 대화창 (문제)
  const typing = document.activeElement && document.activeElement.id === 'answer';
  setHTML($('dialog'), dialogHTML(g, c, m, live, locked));
  const ans = $('answer');
  if (ans && typing && document.activeElement !== ans && !ans.disabled) { ans.value = St.draft; ans.focus(); }
  if ((g.q?.id || null) !== St.draftQ) { St.draft = ''; St.draftQ = g.q?.id || null; }
  if (ans && ans.value !== St.draft && document.activeElement !== ans) ans.value = St.draft;
  const cb = $('coolbar'); if (cb && locked) { const left = g.lockUntil - now; cb.style.width = (left / 10000 * 100).toFixed(1) + '%'; const t = $('cooltxt'); const s = `${Math.ceil(left / 1000)}초 뒤 다시 도전`; if (t.textContent !== s) t.textContent = s; }

  // 아이템, 모둠, 기록, 지도
  setHTML($('items'), Object.keys(ITEMS).map(k => {
    const n = g.items?.[k] || 0; const on = (k === 'shield' && g.shieldOn) || (k === 'hint' && g.hintOn);
    const usable = live && !St.busy && n > 0 && !['dead', 'cleared', 'ready', 'twist'].includes(g.phase)
      && !(k === 'hint' && (!g.q || g.hintOn)) && !(k === 'shield' && g.shieldOn) && !(k === 'potion' && g.hp >= 100);
    return `<button class="item ${on ? 'on' : ''}" data-item="${k}" ${usable ? '' : 'disabled'} title="${ITEMS[k].desc}"><img class="pixelimg" src="${ITEM_ICON[k]()}" alt="">${ITEMS[k].name}<span class="n">×${n}</span></button>`;
  }).join(''));
  setHTML($('team'), `<div class="row"><h3 style="font-size:16px">원정대</h3><span class="spacer"></span><span class="muted" style="font-size:12px">정답 ${g.correct || 0} · 오답 ${g.wrong || 0} · 쓰러짐 ${g.deaths || 0}</span></div>${memberChips(g)}`);
  setHTML($('log'), (g.log || []).map(l => `<div>${esc(l)}</div>`).join(''));
  setHTML($('tower'), Array.from({ length: top }, (_, i) => i + 1).map(n => `<div class="${n === f ? 'cur' : n < f ? 'done' : ''}" title="${n}층 ${esc(monFor(n, top).n)}"><img class="pixelimg" src="${monIcon(n, top)}" alt="">${n}${TREASURE[n] ? '★' : ''}</div>`).join(''));
}

function speaker(icon, name, says) {
  return `<div class="speaker"><img class="pixelimg" src="${icon}" alt="">${esc(name)}${says ? `<span class="says">${esc(says)}</span>` : ''}</div>`;
}
function dialogHTML(g, c, m, live, locked) {
  const f = g.floor, top = g.maxFloor || 20, icon = monIcon(f, top);
  if (c.status === 'paused') return `${speaker(HERO_ICON(), '알림')}<p class="line">선생님이 게임을 잠시 멈췄어요.</p>`;
  if (c.status === 'ended') return `${speaker(HERO_ICON(), '원정 종료')}<p class="line">${g.phase === 'cleared' ? '선생님을 구출했어요! 훌륭해요.' : `${f}층까지 올라갔어요. 수고했어요!`}</p>`;
  const busy = St.busy ? 'disabled' : '';
  if (g.phase === 'ready') return `${speaker(icon, m.n)}<p class="line">${f}층 문 너머에서 ${esc(m.n)}이(가) 기다리고 있다.</p><button class="btn" data-act="enter" ${busy}>${f}층으로 들어가기</button>`;
  if (g.phase === 'won') return `${speaker(icon, m.n)}<p class="line">${esc(m.n)}을(를) 물리쳤다! 다음 층에는 더 강한 몬스터가 기다린다.</p><button class="btn" data-act="next" ${busy}>${f + 1}층으로 올라가기</button>`;
  if (g.phase === 'treasure') {
    const t = TREASURE[f];
    return `${speaker(HERO_ICON(), `${g.no}모둠`, '보물 상자를 열었다!')}
      <div class="row">${Object.entries(t).map(([k, v]) => `<span class="pill"><img class="pixelimg" src="${ITEM_ICON[k]()}" alt="" style="width:20px;height:20px;vertical-align:-4px"> ${ITEMS[k].name} ×${v}</span>`).join('')}</div>
      <p class="line" style="font-size:14px">아이템은 아래 가방에서 언제든 쓸 수 있어요. 회복 물약은 체력 10을 채워요.</p>
      <button class="btn" data-act="next" ${busy}>${f + 1}층으로 올라가기</button>`;
  }
  if (g.phase === 'dead') return `${speaker(icon, m.n)}<p class="line">원정대가 쓰러졌다… ${g.respawnFloor === 1 ? '아이템은 사라지지만 ' : ''}다시 도전할 수 있다.</p><button class="btn red" data-act="revive" ${busy}>부활해서 ${g.respawnFloor}층부터 다시</button>`;
  if (g.phase === 'twist') return `${speaker(monIconOf(SAGE), SAGE.n)}
      <p class="line">“후후후… 용을 쓰러뜨렸다고 끝난 줄 알았느냐? 그 용은 내 부하에 불과했다.<br>너희 선생님은 내가 데려갔다. 구하고 싶다면 <b style="color:var(--gold)">${g.bonus}개의 층</b>을 더 올라와라!”</p>
      <p class="line" style="font-size:14px;color:#bfb5ea">용을 쓰러뜨린 시간: ${mmss(g.dragonAt)} · 흑막의 탑 ${g.bonus}개 층이 열렸어요. 탑에 들어서면 체력이 100으로 회복돼요.</p>
      <button class="btn" data-act="next" ${busy}>흑막의 탑으로 (21층)</button>`;
  if (g.phase === 'cleared') return `${speaker(TEACHER_ICON(), '선생님')}<p class="line">“고마워, 얘들아! 덕분에 살았어.”</p><p class="line" style="font-size:14px;color:#bfb5ea">정답 ${g.correct}개, 오답 ${g.wrong}개. 다른 모둠을 기다리는 동안 헷갈렸던 문장 성분을 정리해 보세요.</p>`;

  // 문제
  const q = g.q; if (!q) return '';
  const dis = !live || !g.myTurn || St.busy || locked;
  const who = g.phase === 'trap' ? speaker(HERO_ICON(), '덫 치료', `맞히면 체력 +${c.trapHeal}`) : speaker(icon, m.n, '이(가) 문제를 냈다!');
  const turnLine = !c.turnMode || (g.members || []).length <= 1 ? '' :
    `<div class="turn">${g.myTurn ? '<b>내 차례예요!</b> 모둠원과 의논한 뒤 답하세요.' : `<span><b>${esc((g.members.find(x => x.turn) || {}).name || '')}</b> 차례예요. 함께 의논해 주세요.</span>${serverNow() - (g.turnAt || 0) > 35000 ? ' <button class="btn ghost sm" id="takeover">대신 풀기</button>' : ''}`}</div>`;
  let body;
  if (q.mode === 'text') {
    const ph = q.multi ? '띄어쓰기로 구분해 입력' : q.type === 'pick' ? '예: 주어' : '정답 입력';
    body = `<form class="ansrow" id="ansf"><input type="text" id="answer" autocomplete="off" autocapitalize="off" placeholder="${ph}" ${dis ? 'disabled' : ''} aria-label="정답"><button class="btn" type="submit" ${dis ? 'disabled' : ''}>공격!</button></form>`;
  } else {
    const long = q.type === 'choice' && q.opts.some(o => o.length > 8);
    body = `<div class="menu ${long ? 'long' : ''}">${q.opts.map((o, i) => `<button class="opt ${(g.hidden || []).includes(i) ? 'gone' : ''}" data-opt="${i}" ${dis || (g.hidden || []).includes(i) ? 'disabled' : ''}>${q.type === 'choice' ? `${'①②③④⑤⑥'[i] || ''} ` : ''}${markup(o)}</button>`).join('')}</div>`;
  }
  return `${who}
    <p class="ask">“${esc(q.ask)}” <span class="modebadge" style="background:transparent;color:#bfb5ea;border-color:#4a4290">${q.mode === 'text' ? '단답형' : '객관식'}</span></p>
    ${q.s ? `<p class="sent">${markup(q.s)}</p>` : ''}
    ${locked ? `<div class="cool"><span id="cooltxt"></span><div class="bar"><i id="coolbar"></i></div></div>` : ''}
    ${body}
    ${q.hint ? `<div class="hint">🧙 현자의 힌트: ${esc(q.hint)}</div>` : ''}
    ${turnLine}`;
}

connect();
