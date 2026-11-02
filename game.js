'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 바둑: 화면·입력·소리. 규칙과 컴퓨터는 logic.js (LOGIC_BADUK).
const L = LOGIC_BADUK;
const $ = (id) => document.getElementById(id);
const N = 9, W = 360, MARGIN = 30, CELL = (W - 2 * MARGIN) / (N - 1);
const canvas = $('game'), ctx = canvas.getContext('2d');

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리 ----------
let audio = null;
let muted = store.get('badukMuted') === '1';
function tone(freq, dur, type = 'square', vol = 0.05, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur);
  } catch (_) {}
}
const melody = (notes, step, type = 'sine', vol = 0.06) => notes.forEach((f, i) => { if (f) setTimeout(() => tone(f, step * 0.9 / 1000, type, vol), i * step); });
const sfx = {
  stone: () => { tone(900, 0.04, 'triangle', 0.07, -500); setTimeout(() => tone(220, 0.06, 'sine', 0.05), 15); },
  capture: () => melody([660, 520, 392], 60, 'triangle', 0.05),
  pass: () => tone(300, 0.12, 'sine', 0.04),
  bad: () => tone(150, 0.14, 'square', 0.05),
  win: () => melody([523, 659, 784, 1047], 90),
  lose: () => melody([330, 262, 196], 160, 'sawtooth', 0.04),
  start: () => melody([392, 494], 90),
};

// ---------- 상태 ----------
let G = L.newGame();
let state = 'title';                           // title · play · paused
let me = L.BLACK, level = 'easy', cursor = -1, hintPt = -1, thinking = false, msg = '', pausedFrom = null, aiTimer = null;
let best = Number(store.get('badukBest')) || 0;

/* @test-hooks:start */
window.__bd = { get G() { return G; }, get state() { return state; }, L, setG(g) { G = g; }, get me() { return me; }, get thinking() { return thinking; }, render: () => render() };
/* @test-hooks:end */

const aiColor = () => L.other(me);
const myTurn = () => state === 'play' && G.phase === 'play' && G.turn === me && !thinking;

// ---------- 흐름 ----------
function bindOverlay() { document.querySelectorAll('#overlay button').forEach((b) => { b.onclick = () => onOverlayButton(b.dataset.level); }); }
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); bindOverlay(); }
function hideOverlay() { $('overlay').classList.add('hidden'); }
function onOverlayButton(lv) { if (state === 'paused') { resume(); return; } startGame(lv); }
function startGame(lv) {
  const tut = /[?&]tutorial=1/.test(location.search);
  if (tut) lv = 'easy';
  level = lv === 'normal' ? 'normal' : 'easy';
  store.set('badukLevel', level);
  const picked = document.querySelector('input[name="color"]:checked');
  me = tut ? L.BLACK : (picked && Number(picked.value) === 2 ? L.WHITE : L.BLACK);
  clearTimeout(aiTimer); thinking = false;
  G = L.newGame(); cursor = -1; hintPt = -1; msg = '';
  state = 'play'; hideOverlay(); sfx.start(); render();
  if (G.turn === aiColor()) scheduleAi();
}
function pause() { if (state !== 'play') return; pausedFrom = state; state = 'paused'; showOverlay('<h2>일시정지</h2><p>P 키나 아래 버튼으로 계속해요</p><button id="startBtn">계속하기</button>'); }
function resume() { if (state !== 'paused') return; state = pausedFrom; hideOverlay(); render(); if (G.phase === 'play' && G.turn === aiColor() && !thinking) scheduleAi(); }

// 컴퓨터 차례: 화면에 '생각 중'을 먼저 보여 준 뒤 계산한다
function scheduleAi() {
  if (G.phase !== 'play') return;
  thinking = true; render();
  clearTimeout(aiTimer);
  aiTimer = setTimeout(() => {
    if (state !== 'play') { thinking = false; return; }
    const opts = level === 'normal' ? { ms: 1400, playouts: 6000, tacticsChance: 1 } : { playouts: 120, tacticsChance: 0.5 };
    const m = L.chooseMove(G, opts);
    thinking = false;
    if (m < 0) { L.pass(G); msg = '컴퓨터가 패스했어요'; sfx.pass(); }
    else { const r = L.play(G, m); if (!r.ok) { L.pass(G); msg = '컴퓨터가 패스했어요'; } else { sfx.stone(); if (r.captured.length) { sfx.capture(); msg = `컴퓨터가 ${r.captured.length}점을 잡았어요`; } else msg = ''; } }
    afterMove(); render();
  }, level === 'normal' ? 350 : 500);
}
function afterMove() {
  if (G.phase === 'scoring') { G.dead = L.estimateDead(G, level === 'normal' ? 200 : 100); msg = '둘 다 패스했어요. 죽은 돌을 확인해 주세요 (돌을 누르면 바뀌어요)'; }
}

// ---------- 내 행동 ----------
function place() {
  if (!myTurn() || cursor < 0) return;
  const r = L.play(G, cursor);
  if (!r.ok) { msg = r.why; sfx.bad(); render(); return; }
  tutorialSignal('place'); sfx.stone(); if (r.captured.length) { sfx.capture(); tutorialSignal('capture'); msg = `${r.captured.length}점을 잡았어요`; } else msg = '';
  cursor = -1; hintPt = -1; render(); afterMove(); if (G.phase === 'play') scheduleAi(); else render();
}
function passMove() {
  if (!myTurn()) return;
  L.pass(G); sfx.pass(); tutorialSignal('pass'); msg = '패스했어요'; cursor = -1; hintPt = -1; afterMove(); render();
  if (G.phase === 'play') scheduleAi();
}
function undoMove() {
  if (state !== 'play' || thinking || G.phase === 'over') return;
  // 내가 둔 수까지 되돌린다 (컴퓨터의 수와 내 수 한 쌍)
  const mine = G.moves.length && G.moves[G.moves.length - 1].color === me ? 1 : 2;
  if (!G.snapshots.length) return;
  L.undo(G, Math.min(mine, G.snapshots.length));
  if (G.turn === aiColor() && G.moves.length === 0 && me === L.WHITE) { /* 백으로 첫 수 전: 컴퓨터가 다시 둠 */ scheduleAi(); }
  msg = '한 수 물렀어요'; cursor = -1; hintPt = -1; tutorialSignal('undo'); sfx.pass(); render();
}
function hint() {
  if (!myTurn()) return;
  thinking = true; msg = '추천 수를 찾는 중…'; render();
  setTimeout(() => { const m = L.chooseMove(G, { playouts: 500 }); thinking = false; if (m < 0) { msg = '둘 곳이 없어 보여요. 패스해도 좋아요'; hintPt = -1; } else { hintPt = m; cursor = m; msg = '파란 동그라미가 추천 자리예요'; } render(); }, 30);
}
function resign() {
  if (!myTurn()) return;
  if (!confirm('기권할까요?')) return;
  L.resign(G, me); showEnd();
}
function finishGame() { if (G.phase !== 'scoring') return; L.finish(G); showEnd(); }
function continuePlay() { if (G.phase !== 'scoring') return; L.resume(G); msg = '계속 둬요'; render(); if (G.turn === aiColor()) scheduleAi(); }
function showEnd() {
  const r = G.result, won = r.winner === me;
  (won ? sfx.win : sfx.lose)();
  let detail = r.resign ? (won ? '컴퓨터가 기권했어요' : '기권했어요') : `흑 ${r.black} : 백 ${r.white} → ${r.winner === L.BLACK ? '흑' : '백'} ${r.margin}집 승`;
  let extra = '';
  if (won && !r.resign && level === 'normal' && r.margin > best) { best = r.margin; store.set('badukBest', String(best)); extra = '<p>🏆 최고 기록!</p>'; }
  showOverlay(`<h2>${won ? '🏆 이겼어요!' : '졌어요'}</h2><p class="big">${detail}</p>${extra}<div class="pick"><label><input type="radio" name="color" value="1" ${me === 1 ? 'checked' : ''}> 흑(먼저)</label><label><input type="radio" name="color" value="2" ${me === 2 ? 'checked' : ''}> 백(나중)</label></div><div class="lv"><button id="startBtn" data-level="easy">쉬움으로 다시<small>컴퓨터가 빨리 두고 서툴러요</small></button><button id="startBtn2" data-level="normal">보통으로 다시<small>컴퓨터가 오래 생각해요</small></button></div><p class="note">쉬움에서는 최고 기록(이긴 집 수)이 저장되지 않아요</p>`);
}

// ---------- 입력 ----------
canvas.addEventListener('pointerdown', (e) => {
  const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * W / r.height;
  const c = Math.round((x - MARGIN) / CELL), rr = Math.round((y - MARGIN) / CELL);
  if (c < 0 || c >= N || rr < 0 || rr >= N) return;
  const idx = rr * N + c;
  if (G.phase === 'scoring' && state === 'play') { if (L.toggleDead(G, idx)) { sfx.stone(); render(); } return; }
  if (!myTurn()) return;
  if (cursor === idx) { place(); return; }                  // 같은 점을 한 번 더 누르면 착수
  cursor = idx; hintPt = hintPt === idx ? idx : -1; render();
});
$('btnPlay').onclick = place; $('btnPass').onclick = passMove; $('btnUndo').onclick = undoMove; $('btnHint').onclick = hint; $('btnResign').onclick = resign;
$('btnFinish').onclick = finishGame; $('btnContinue').onclick = continuePlay;
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (state === 'title') { if (k === 'enter') { e.preventDefault(); onOverlayButton(level); } return; }
  if (state === 'paused') { if (k === 'p' || k === 'enter') resume(); return; }
  if (!$('overlay').classList.contains('hidden')) return;
  if (k === 'enter') place(); else if (k === 'p') passMove(); else if (k === 'u') undoMove(); else if (k === 'm') toggleMute();
  else if (cursor >= 0 && myTurn() && ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { e.preventDefault(); const r0 = Math.floor(cursor / N), c0 = cursor % N; const nr = Math.max(0, Math.min(N - 1, r0 + (k === 'arrowdown') - (k === 'arrowup'))), nc = Math.max(0, Math.min(N - 1, c0 + (k === 'arrowright') - (k === 'arrowleft'))); cursor = nr * N + nc; render(); }
});

// ---------- 그리기 ----------
const px = (c) => MARGIN + c * CELL;
function stone(x, y, color, alpha = 1, r = CELL * 0.46) {
  ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  if (color === L.BLACK) { g.addColorStop(0, '#6a6a6a'); g.addColorStop(1, '#0a0a0a'); } else { g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#c8c8c0'); }
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.strokeStyle = color === L.BLACK ? '#000' : '#8a8a80'; ctx.lineWidth = 0.8; ctx.stroke();
  ctx.globalAlpha = 1;
}
function draw() {
  canvas.width = W * 2; canvas.height = W * 2; ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.fillStyle = '#e0b060'; ctx.fillRect(0, 0, W, W);
  ctx.strokeStyle = 'rgba(90,50,10,.25)'; ctx.lineWidth = 1; for (let i = 0; i < 14; i++) { ctx.beginPath(); ctx.moveTo(0, i * 27 + 7); ctx.bezierCurveTo(100, i * 27, 260, i * 27 + 14, W, i * 27 + 5); ctx.stroke(); }
  ctx.strokeStyle = '#3a2a10'; ctx.lineWidth = 1;
  for (let i = 0; i < N; i++) { ctx.beginPath(); ctx.moveTo(px(0), px(i)); ctx.lineTo(px(N - 1), px(i)); ctx.stroke(); ctx.beginPath(); ctx.moveTo(px(i), px(0)); ctx.lineTo(px(i), px(N - 1)); ctx.stroke(); }
  ctx.lineWidth = 2; ctx.strokeRect(px(0), px(0), px(N - 1) - px(0), px(N - 1) - px(0));
  ctx.fillStyle = '#3a2a10'; for (const [r, c] of [[2, 2], [2, 6], [6, 2], [6, 6], [4, 4]]) { ctx.beginPath(); ctx.arc(px(c), px(r), 3, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#5a3a10'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < N; i++) { ctx.fillText('ABCDEFGHJ'[i], px(i), 12); ctx.fillText(String(N - i), 12, px(i)); }
  const scoring = G.phase === 'scoring' || G.phase === 'over';
  const sc = scoring ? L.score(G) : null;
  for (let i = 0; i < N * N; i++) {
    const r = Math.floor(i / N), c = i % N, x = px(c), y = px(r), v = G.board[i];
    if (v) stone(x, y, v, G.dead.has(i) ? 0.45 : 1);
    if (sc && !v && sc.owner[i]) { ctx.fillStyle = sc.owner[i] === L.BLACK ? '#000' : '#fff'; ctx.globalAlpha = 0.85; ctx.fillRect(x - 4, y - 4, 8, 8); ctx.globalAlpha = 1; ctx.strokeStyle = '#222'; ctx.strokeRect(x - 4, y - 4, 8, 8); }
    if (sc && v && G.dead.has(i)) { ctx.strokeStyle = '#d02020'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke(); }
  }
  // 마지막 수 표시와 패
  if (G.last >= 0) { const x = px(G.last % N), y = px(Math.floor(G.last / N)); ctx.strokeStyle = G.board[G.last] === L.BLACK ? '#fff' : '#d02020'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, CELL * 0.2, 0, 7); ctx.stroke(); }
  if (G.ko >= 0 && G.phase === 'play') { const x = px(G.ko % N), y = px(Math.floor(G.ko / N)); ctx.strokeStyle = '#d02020'; ctx.lineWidth = 2; ctx.strokeRect(x - 5, y - 5, 10, 10); }
  // 내가 고른 자리(반투명 돌)와 추천 자리
  if (cursor >= 0 && myTurn()) { const x = px(cursor % N), y = px(Math.floor(cursor / N)); if (!G.board[cursor]) stone(x, y, me, 0.55); ctx.strokeStyle = '#2a8a2a'; ctx.lineWidth = 2; ctx.strokeRect(x - CELL * 0.5, y - CELL * 0.5, CELL, CELL); }
  if (hintPt >= 0) { const x = px(hintPt % N), y = px(Math.floor(hintPt / N)); ctx.strokeStyle = '#2a5ad8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, CELL * 0.52, 0, 7); ctx.stroke(); }
}
function render() {
  if (state === 'title') { draw(); return; }
  draw();
  const c = G.captures; let line;
  const name = (col) => (col === me ? '나' : '컴퓨터');
  if (G.phase === 'play') line = thinking && G.turn === aiColor() ? '컴퓨터가 생각하는 중…' : G.turn === me ? `내 차례 (${me === L.BLACK ? '⚫ 흑' : '⚪ 백'})` : '컴퓨터 차례';
  else if (G.phase === 'scoring') { const s = L.score(G); line = `계가 확인 — 흑 ${s.black} : 백 ${s.white} (${s.margin > 0 ? '흑' : '백'} ${Math.abs(s.margin)}집 앞)`; }
  else line = '';
  $('info').innerHTML = `${esc(line)}<br><span style="font-weight:600;opacity:.85">⚫ ${name(1)} 잡은 돌 ${c[1]} · ⚪ ${name(2)} 잡은 돌 ${c[2]} · ${G.moves.length}수${msg ? ' · ' + esc(msg) : ''}</span>`;
  const play = myTurn(), scoring = G.phase === 'scoring';
  $('btnPlay').disabled = !(play && cursor >= 0 && !G.board[cursor]); $('btnPass').disabled = !play; $('btnUndo').disabled = !(state === 'play' && !thinking && G.snapshots.length && G.phase === 'play');
  $('btnHint').disabled = !play; $('btnResign').disabled = !play;
  $('scoreRow').classList.toggle('hidden', !scoring);
}
const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function toggleMute() { muted = !muted; store.set('badukMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';
addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
bindOverlay();
render();
