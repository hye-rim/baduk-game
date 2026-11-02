'use strict';
// 바둑(9로) 규칙과 컴퓨터 (DOM 없음). 화면은 game.js, 시험은 test/logic.test.js
// 한국식: 집 계산(집 + 잡은 돌 + 덤 6.5). 돌: 1 흑 · 2 백. 점은 0 ~ size*size-1 (행 * size + 열)
const LOGIC_BADUK = (() => {
  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const SIZE = 9, KOMI = 6.5;
  const other = (c) => 3 - c;

  const rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // ---------- 판 도구 ----------
  const topo = {};
  function topology(n) {
    if (topo[n]) return topo[n];
    const N = n * n, nb = [], diag = [];
    for (let i = 0; i < N; i++) {
      const r = Math.floor(i / n), c = i % n, a = [], d = [];
      if (r > 0) a.push(i - n); if (c > 0) a.push(i - 1); if (c < n - 1) a.push(i + 1); if (r < n - 1) a.push(i + n);
      if (r > 0 && c > 0) d.push(i - n - 1); if (r > 0 && c < n - 1) d.push(i - n + 1); if (r < n - 1 && c > 0) d.push(i + n - 1); if (r < n - 1 && c < n - 1) d.push(i + n + 1);
      nb.push(a); diag.push(d);
    }
    // 판의 해시 (같은 모양이 다시 나오는 것을 막기 위해)
    const z = [new Int32Array(N), new Int32Array(N), new Int32Array(N)];
    const r = rng(2024);
    for (let c = 1; c <= 2; c++) for (let i = 0; i < N; i++) z[c][i] = (r() * 4294967296) | 0;
    return (topo[n] = { N, nb, diag, z });
  }
  // 같은 색으로 이어진 돌 덩어리와 활로
  function group(board, idx, n) {
    const { nb } = topology(n), color = board[idx];
    const stones = [idx], seen = new Set([idx]), libs = new Set();
    for (let k = 0; k < stones.length; k++) for (const j of nb[stones[k]]) {
      if (board[j] === EMPTY) libs.add(j);
      else if (board[j] === color && !seen.has(j)) { seen.add(j); stones.push(j); }
    }
    return { stones, libs: [...libs], color };
  }
  const hashOf = (board, n) => { const { z, N } = topology(n); let h = 0; for (let i = 0; i < N; i++) if (board[i]) h ^= z[board[i]][i]; return h >>> 0; };

  // 돌 하나를 놓아 본다. 판을 직접 바꾸고 결과를 돌려준다: { ok, captured: [점...] } 또는 { ok: false, why }
  // 자충(활로가 없어지는 수)은 상대 돌을 잡을 때만 둘 수 있다
  function place(board, idx, color, n) {
    if (board[idx] !== EMPTY) return { ok: false, why: '이미 돌이 있어요' };
    const { nb } = topology(n);
    board[idx] = color;
    const captured = [];
    for (const j of nb[idx]) if (board[j] === other(color)) {
      const g = group(board, j, n);
      if (!g.libs.length) for (const s of g.stones) if (board[s] !== EMPTY) { board[s] = EMPTY; captured.push(s); }
    }
    if (!captured.length) {
      const g = group(board, idx, n);
      if (!g.libs.length) { board[idx] = EMPTY; return { ok: false, why: '둘 수 없는 자리예요 (활로가 없는 자충수)' }; }
    }
    return { ok: true, captured };
  }

  // ---------- 게임 ----------
  function newGame(opts = {}) {
    const n = opts.size || SIZE;
    const st = {
      size: n, board: new Int8Array(n * n), turn: BLACK, captures: [0, 0, 0], passes: 0, history: new Set(), moves: [], last: -1, ko: -1,
      phase: 'play', result: null, komi: opts.komi !== undefined ? opts.komi : KOMI, dead: new Set(), snapshots: [],
    };
    st.history.add(hashOf(st.board, n));
    return st;
  }
  const snap = (st) => ({ board: st.board.slice(), turn: st.turn, captures: st.captures.slice(), passes: st.passes, history: new Set(st.history), moves: st.moves.slice(), last: st.last, ko: st.ko });
  function restore(st, s) { st.board = s.board.slice(); st.turn = s.turn; st.captures = s.captures.slice(); st.passes = s.passes; st.history = new Set(s.history); st.moves = s.moves.slice(); st.last = s.last; st.ko = s.ko; st.phase = 'play'; st.result = null; st.dead = new Set(); }

  // 내 차례에 idx 에 둔다
  function play(st, idx) {
    if (st.phase !== 'play') return { ok: false, why: '지금은 둘 수 없어요' };
    const n = st.size;
    if (!Number.isInteger(idx) || idx < 0 || idx >= n * n) return { ok: false, why: '판 밖이에요' };
    const color = st.turn, b = st.board.slice();
    const r = place(b, idx, color, n);
    if (!r.ok) return r;
    const h = hashOf(b, n);
    if (st.history.has(h)) return { ok: false, why: '같은 모양이 다시 나오는 수예요 (패)' };
    st.snapshots.push(snap(st));
    st.board = b; st.history.add(h); st.captures[color] += r.captured.length;
    // 단순 패 표시: 한 점을 잡았고 내 돌이 활로 하나인 외돌이면 잡힌 자리가 패자리
    st.ko = -1;
    if (r.captured.length === 1) { const g = group(b, idx, n); if (g.stones.length === 1 && g.libs.length === 1) st.ko = r.captured[0]; }
    st.passes = 0; st.last = idx; st.moves.push({ color, idx, captured: r.captured.length }); st.turn = other(color);
    return { ok: true, captured: r.captured };
  }
  function pass(st) {
    if (st.phase !== 'play') return false;
    st.snapshots.push(snap(st));
    st.moves.push({ color: st.turn, idx: -1, captured: 0 }); st.passes++; st.last = -1; st.ko = -1; st.turn = other(st.turn);
    if (st.passes >= 2) { st.phase = 'scoring'; st.dead = new Set(); }
    return true;
  }
  // 계가 중에 아직 끝나지 않았다고 생각되면 계속 둔다
  function resume(st) { if (st.phase !== 'scoring') return false; st.phase = 'play'; st.passes = 0; st.dead = new Set(); return true; }
  function resign(st, color) { if (st.phase === 'over') return false; st.phase = 'over'; st.result = { winner: other(color), resign: true, black: 0, white: 0, margin: 0 }; return true; }
  function undo(st, count = 1) {
    let did = 0;
    while (count-- > 0 && st.snapshots.length) { restore(st, st.snapshots.pop()); did++; }
    return did > 0;
  }
  function legalMoves(st) {
    const out = [], n = st.size;
    for (let i = 0; i < n * n; i++) { if (st.board[i]) continue; const b = st.board.slice(); const r = place(b, i, st.turn, n); if (r.ok && !st.history.has(hashOf(b, n))) out.push(i); }
    return out;
  }

  // ---------- 계가 (한국식: 집 + 잡은 돌 + 덤) ----------
  // 죽은 돌을 들어낸 판에서 빈 곳 덩어리마다 어느 쪽 돌에만 둘러싸였는지 본다
  function territories(board, n, deadStones = []) {
    const { nb, N } = topology(n);
    const b = board.slice(); for (const s of deadStones) b[s] = EMPTY;
    const owner = new Int8Array(N), seen = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (b[i] !== EMPTY || seen[i]) continue;
      const pts = [i]; seen[i] = 1; let touchB = false, touchW = false;
      for (let k = 0; k < pts.length; k++) for (const j of nb[pts[k]]) { if (b[j] === EMPTY) { if (!seen[j]) { seen[j] = 1; pts.push(j); } } else if (b[j] === BLACK) touchB = true; else touchW = true; }
      const who = touchB && !touchW ? BLACK : touchW && !touchB ? WHITE : 0;
      if (who) for (const p of pts) owner[p] = who;
    }
    return { owner, b };
  }
  function score(st, deadSet = st.dead) {
    const n = st.size, dead = [...deadSet];
    const { owner, b } = territories(st.board, n, dead);
    let tb = 0, tw = 0;
    for (let i = 0; i < n * n; i++) { if (owner[i] === BLACK) tb++; else if (owner[i] === WHITE) tw++; }
    const deadW = dead.filter((s) => st.board[s] === WHITE).length, deadB = dead.filter((s) => st.board[s] === BLACK).length;
    const black = tb + st.captures[BLACK] + deadW, white = tw + st.captures[WHITE] + deadB + st.komi;
    return { black, white, margin: black - white, territoryB: tb, territoryW: tw, owner, deadB, deadW, board: b };
  }
  // 죽은 돌 표시를 바꾼다: 돌 한 점을 누르면 그 덩어리 전체가 죽음/삶으로 바뀐다
  function toggleDead(st, idx) {
    if (st.phase !== 'scoring' || !st.board[idx]) return false;
    const g = group(st.board, idx, st.size);
    const isDead = st.dead.has(idx);
    for (const s of g.stones) { if (isDead) st.dead.delete(s); else st.dead.add(s); }
    return true;
  }
  function finish(st) {
    if (st.phase !== 'scoring') return null;
    const sc = score(st);
    st.phase = 'over';
    st.result = { winner: sc.margin > 0 ? BLACK : WHITE, black: sc.black, white: sc.white, margin: Math.abs(sc.margin), resign: false };
    return st.result;
  }

  // ---------- 컴퓨터 (몬테카를로 나무 탐색) ----------
  // 빈 점이 같은 색 돌로만 둘러싸인 '눈'인지 (가짜 눈은 제외)
  function isOwnEye(board, idx, color, n) {
    const { nb, diag } = topology(n);
    for (const j of nb[idx]) if (board[j] !== color) return false;
    let bad = 0; const d = diag[idx];
    for (const j of d) if (board[j] !== color) bad++;
    return d.length < 4 ? bad === 0 : bad < 2;
  }
  // 연습용 빠른 수 놓기 (패는 바로 직전 한 수만 막는다)
  function fastMove(board, idx, color, n, ko) {
    if (board[idx] !== EMPTY || idx === ko) return null;
    const r = place(board, idx, color, n);
    return r.ok ? r.captured : null;
  }
  // 무작위로 끝까지 둬서 결과 판을 돌려준다
  function playout(board0, turn, n, rand, ko0) {
    const board = board0.slice(), N = n * n, { nb } = topology(n);
    let color = turn, passes = 0, ko = ko0, moves = 0, last = -1;
    const koAfter = (cap, j) => { if (cap.length !== 1) return -1; const g = group(board, j, n); return g.stones.length === 1 && g.libs.length === 1 ? cap[0] : -1; };
    while (passes < 2 && moves < N * 2) {
      let moved = false;
      // 마지막 수 근처를 가끔 먼저 본다 (끊고 이어가는 흐름)
      if (last >= 0 && rand() < 0.4) {
        const cand = nb[last].filter((j) => board[j] === EMPTY);
        while (cand.length) {
          const k = Math.floor(rand() * cand.length), j = cand.splice(k, 1)[0];
          if (isOwnEye(board, j, color, n)) continue;
          const cap = fastMove(board, j, color, n, ko);
          if (cap) { ko = koAfter(cap, j); last = j; moved = true; break; }
        }
      }
      if (!moved) {
        const pool = []; for (let i = 0; i < N; i++) if (!board[i]) pool.push(i);
        for (let t = 0; t < 40 && pool.length; t++) {
          const k = Math.floor(rand() * pool.length), j = pool[k];
          pool[k] = pool[pool.length - 1]; pool.pop();
          if (isOwnEye(board, j, color, n)) continue;
          const cap = fastMove(board, j, color, n, ko);
          if (cap) { ko = koAfter(cap, j); last = j; moved = true; break; }
        }
      }
      if (moved) passes = 0; else { passes++; ko = -1; last = -1; }
      color = other(color); moves++;
    }
    return board;
  }
  // 빠른 면적 점수 (놀이용): 돌 + 둘러싼 빈 곳
  function areaDiff(board, n) {
    const { owner } = territories(board, n);
    let b = 0, w = 0;
    for (let i = 0; i < n * n; i++) { if (board[i] === BLACK || owner[i] === BLACK) b++; else if (board[i] === WHITE || owner[i] === WHITE) w++; }
    return b - w;
  }
  // 몬테카를로로 죽은 돌 짐작: 끝까지 둔 판들에서 그 돌 자리가 상대 쪽으로 넘어가는 비율
  function estimateDead(st, playouts = 120, rand = Math.random) {
    const n = st.size, N = n * n, own = new Float32Array(N * 3);
    for (let k = 0; k < playouts; k++) {
      const end = playout(st.board, st.turn, n, rand, -1);
      const { owner } = territories(end, n);
      for (let i = 0; i < N; i++) { const o = end[i] || owner[i]; if (o) own[i * 3 + o]++; }
    }
    const dead = new Set(), seen = new Set();
    for (let i = 0; i < N; i++) {
      const c = st.board[i]; if (!c || seen.has(i)) continue;
      const g = group(st.board, i, n); g.stones.forEach((s) => seen.add(s));
      let against = 0; for (const s of g.stones) against += own[s * 3 + other(c)] / playouts;
      if (against / g.stones.length >= 0.7) for (const s of g.stones) dead.add(s);
    }
    return dead;
  }

  // 바로 보이는 전술: 잡을 수 있으면 잡고(잡은 뒤 위험하지 않을 때), 한 수 남은 내 돌은 살린다. 없으면 -2
  function tactical(st, legal) {
    const n = st.size, me = st.turn; let best = -2, bestV = 0;
    for (const i of legal) {
      const b = st.board.slice(), r = place(b, i, me, n);
      if (!r.ok) continue;
      const g = group(b, i, n);
      if (r.captured.length && (g.libs.length >= 2 || r.captured.length >= 2)) { const v = 100 + r.captured.length * 10 + g.libs.length; if (v > bestV) { bestV = v; best = i; } }
    }
    if (best >= 0) return best;
    const seen = new Set();
    for (let i = 0; i < n * n; i++) {
      if (st.board[i] !== me || seen.has(i)) continue;
      const g = group(st.board, i, n); g.stones.forEach((x) => seen.add(x));
      if (g.libs.length !== 1) continue;
      const l = g.libs[0]; if (!legal.includes(l)) continue;
      const b = st.board.slice(), r = place(b, l, me, n);
      if (r.ok && group(b, l, n).libs.length >= 2) { const v = 50 + g.stones.length; if (v > bestV) { bestV = v; best = l; } }
    }
    return best;
  }

  // 지금 두는 쪽이 둘 수 있는 수를 몬테카를로 나무 탐색으로 고른다. 되돌려 주는 값: 점 번호, 또는 -1 (패스)
  function chooseMove(st, opts = {}) {
    const n = st.size, N = n * n, rand = opts.rand || Math.random, me = st.turn;
    const limit = opts.playouts || 400, until = opts.ms ? Date.now() + opts.ms : Infinity;
    const { nb } = topology(n);
    const legal = legalMoves(st).filter((i) => !isOwnEye(st.board, i, me, n));
    // 상대가 패스했고 지금 이기고 있으면 패스해서 끝낸다
    if (st.passes === 1) {
      const dead = estimateDead(st, 80, rand);
      const sc = score(st, dead);
      if ((me === BLACK ? sc.margin : -sc.margin) > 2) return -1;
    }
    if (!legal.length) return -1;
    if (opts.tactics !== false && rand() < (opts.tacticsChance === undefined ? 1 : opts.tacticsChance)) { const t = tactical(st, legal); if (t >= 0) return t; }
    // 바로 잡을 수 있는 수 / 위험한 자기 돌 구하기: 가장 큰 덩어리를 우선 고려 후보로 가산점
    const bonus = new Float32Array(N);
    const seenG = new Set();
    for (let i = 0; i < N; i++) {
      const c = st.board[i]; if (!c || seenG.has(i)) continue;
      const g = group(st.board, i, n); g.stones.forEach((s) => seenG.add(s));
      if (g.libs.length === 1) for (const l of g.libs) bonus[l] += g.stones.length * (c === me ? 2.5 : 3);       // 한 수 남은 돌: 잡거나 살린다
      else if (g.libs.length === 2 && c !== me) for (const l of g.libs) bonus[l] += g.stones.length * 0.3;
    }
    // 초반에는 가장자리보다 중앙 쪽 점수를 약간 선호한다 (한 줄·두 줄 가장자리는 불리)
    const prior = new Float32Array(N), early = Math.max(0, 1 - st.moves.length / 30);
    for (let i = 0; i < N; i++) { const rr = Math.floor(i / n), cc = i % n, d = Math.min(rr, cc, n - 1 - rr, n - 1 - cc); prior[i] = (d === 0 ? -1.2 : d === 1 ? -0.3 : d === 2 ? 0.35 : 0.5) * early; }
    for (let i = 0; i < N; i++) bonus[i] += prior[i] * 2;
    const root = { move: -2, parent: null, kids: [], wins: 0, n: 0, untried: legal.slice().sort((a, b) => bonus[b] - bonus[a] + (rand() - 0.5) * 0.2), player: other(me) };
    let iters = 0;
    while (iters < limit && Date.now() < until) {
      iters++;
      let node = root, board = st.board.slice(), color = me, ko = st.ko, hist = null;
      // 선택
      while (!node.untried.length && node.kids.length) {
        let best = null, bv = -1;
        const lg = Math.log(node.n + 1);
        for (const k of node.kids) { const v = k.wins / (k.n + 1e-9) + 0.55 * Math.sqrt(lg / (k.n + 1e-9)) + 0.25 * prior[k.move] / (k.n + 1); if (v > bv) { bv = v; best = k; } }
        node = best; const cap = fastMove(board, node.move, color, n, ko);
        ko = cap && cap.length === 1 && group(board, node.move, n).stones.length === 1 && group(board, node.move, n).libs.length === 1 ? cap[0] : -1;
        color = other(color);
      }
      // 펼치기
      if (node.untried.length) {
        const mv = node.untried.shift(); const cap = fastMove(board, mv, color, n, ko);
        if (cap) {
          ko = cap.length === 1 && group(board, mv, n).stones.length === 1 && group(board, mv, n).libs.length === 1 ? cap[0] : -1;
          const kid = { move: mv, parent: node, kids: [], wins: 0, n: 0, player: color, untried: [] };
          color = other(color);
          for (let i = 0; i < N; i++) if (!board[i] && !isOwnEye(board, i, color, n)) kid.untried.push(i);
          node.kids.push(kid); node = kid;
        }
      }
      // 끝까지 두기
      const end = playout(board, color, n, rand, ko);
      const diff = areaDiff(end, n) - st.komi;                 // 흑이 이기면 양수
      const blackWins = diff > 0;
      // 거슬러 올라가며 기록
      for (let nd = node; nd; nd = nd.parent) { nd.n++; if ((nd.player === BLACK) === blackWins) nd.wins++; }
    }
    if (!root.kids.length) return -1;
    let best = root.kids[0];
    for (const k of root.kids) if (k.n > best.n) best = k;
    return best.move;
  }

  return {
    EMPTY, BLACK, WHITE, SIZE, KOMI, rng, other, topology, group, hashOf, place, newGame, play, pass, resume, resign, undo, legalMoves, territories, score, toggleDead, finish, isOwnEye,
    playout, areaDiff, estimateDead, chooseMove,
  };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_BADUK;
