'use strict';
// 바둑 규칙 시험. 실행: node --test
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const P = (r, c) => r * 9 + c;
// 그림으로 판 만들기: 줄마다 9글자 (. 빈 곳, X 흑, O 백)
function board(rows) { const st = L.newGame(); rows.forEach((row, r) => [...row].forEach((ch, c) => { st.board[P(r, c)] = ch === 'X' ? 1 : ch === 'O' ? 2 : 0; })); st.history = new Set([L.hashOf(st.board, 9)]); return st; }
const libs = (st, r, c) => L.group(st.board, P(r, c), 9).libs.length;

test('the board is 9 by 9, black plays first, komi is 6.5', () => {
  const st = L.newGame();
  assert.strictEqual(st.size, 9); assert.strictEqual(st.board.length, 81); assert.strictEqual(st.turn, L.BLACK); assert.strictEqual(st.komi, 6.5);
  assert.strictEqual(L.legalMoves(st).length, 81);
});

test('stones alternate and an occupied point cannot be played', () => {
  const st = L.newGame();
  assert.ok(L.play(st, P(4, 4)).ok); assert.strictEqual(st.turn, L.WHITE); assert.strictEqual(st.board[P(4, 4)], 1);
  const bad = L.play(st, P(4, 4)); assert.strictEqual(bad.ok, false);
  assert.ok(L.play(st, P(4, 5)).ok); assert.strictEqual(st.board[P(4, 5)], 2);
  assert.strictEqual(L.play(st, -1).ok, false); assert.strictEqual(L.play(st, 81).ok, false);
});

test('an edge stone is taken with three stones', () => {
  const st = L.newGame();
  L.play(st, P(0, 3)); L.play(st, P(0, 4)); L.play(st, P(0, 5)); L.play(st, P(8, 0));
  assert.strictEqual(libs(st, 0, 4), 1, 'white stone on the edge has one liberty left (1,4)');
  const r = L.play(st, P(1, 4)); assert.ok(r.ok); assert.deepStrictEqual(r.captured, [P(0, 4)]);
});

test('the corner stone is taken with two stones', () => {
  const st = L.newGame();
  L.play(st, P(0, 0)); L.play(st, P(0, 1)); L.play(st, P(8, 8)); const r = L.play(st, P(1, 0));
  assert.ok(r.ok); assert.deepStrictEqual(r.captured, [P(0, 0)]); assert.strictEqual(st.board[P(0, 0)], 0); assert.strictEqual(st.captures[L.WHITE], 1);
});

test('a group is captured all at once and the captured count is added', () => {
  const st = board(['.XX......', 'OOO......', '.........', '.........', '.........', '.........', '.........', '.........', '.........']);
  st.board[P(0, 0)] = 2; st.turn = L.WHITE;
  const g = L.group(st.board, P(0, 1), 9); assert.strictEqual(g.stones.length, 2);
  const r = L.play(st, P(0, 3)); assert.ok(r.ok); assert.strictEqual(r.captured.length, 2);
  assert.strictEqual(st.board[P(0, 1)], 0); assert.strictEqual(st.board[P(0, 2)], 0); assert.strictEqual(st.captures[L.WHITE], 2);
});

test('suicide is illegal when it captures nothing', () => {
  const st = board(['.O.......', 'OO.......', '.........', '.........', '.........', '.........', '.........', '.........', '.........']);
  st.turn = L.BLACK;
  const r = L.play(st, P(0, 0)); assert.strictEqual(r.ok, false); assert.ok(/활로|자충/.test(r.why));
  assert.strictEqual(st.board[P(0, 0)], 0, 'the board is untouched'); assert.strictEqual(st.turn, L.BLACK, 'still black to move');
});

test('playing into a point with no liberties is allowed when it captures an opposing group', () => {
  // 흑이 (0,0) 에 두면 활로가 없지만 백 (0,1) 한 점을 잡는다
  const st = board(['.OX......', 'O.X......', '.........', '.........', '.........', '.........', '.........', '.........', '.........']);
  st.board[P(0, 1)] = 2; st.board[P(1, 0)] = 2; st.board[P(0, 2)] = 1; st.board[P(1, 1)] = 1; st.board[P(2, 0)] = 1;
  // (0,0) 의 이웃: (0,1) 백, (1,0) 백. (0,1) 백의 활로: (0,0) 만 남게 (1,1) 흑 (0,2) 흑. (1,0) 백의 활로: (0,0) (2,0)흑 (1,1)흑 → 둘 다 (0,0) 하나뿐
  st.turn = L.BLACK;
  const r = L.play(st, P(0, 0)); assert.ok(r.ok, r.why); assert.strictEqual(r.captured.length, 2); assert.strictEqual(st.board[P(0, 0)], 1);
});

test('ko: the stone just captured cannot be retaken at once, but can be after playing elsewhere', () => {
  const st = board(['.O.......', 'OXO......'.replace('X', '.'), '.O.......', '.........', '.........', '.........', '.........', '.........', '.........']);
  // 백 (0,1) (2,1) (1,0) (1,2) 와 흑 (0,2) (2,2) (1,3): 흑이 (1,1) 에 두면 백 (1,2) 한 점을 잡는 패
  for (let i = 0; i < 81; i++) st.board[i] = 0;
  [[0, 1], [2, 1], [1, 0], [1, 2]].forEach(([r, c]) => { st.board[P(r, c)] = 2; });
  [[0, 2], [2, 2], [1, 3]].forEach(([r, c]) => { st.board[P(r, c)] = 1; });
  st.history = new Set([L.hashOf(st.board, 9)]); st.turn = L.BLACK;
  const r = L.play(st, P(1, 1)); assert.ok(r.ok, r.why); assert.deepStrictEqual(r.captured, [P(1, 2)]); assert.strictEqual(st.ko, P(1, 2));
  const again = L.play(st, P(1, 2)); assert.strictEqual(again.ok, false); assert.ok(/패|같은 모양/.test(again.why));
  assert.strictEqual(st.turn, L.WHITE, 'a refused move does not change the turn');
  L.play(st, P(8, 8)); L.play(st, P(8, 0));            // 서로 다른 곳에 두고
  const later = L.play(st, P(1, 2)); assert.ok(later.ok, later.why); assert.deepStrictEqual(later.captured, [P(1, 1)]);
});

test('two passes in a row move the game to scoring; a move in between resets the count', () => {
  const st = L.newGame();
  L.pass(st); assert.strictEqual(st.phase, 'play'); L.play(st, P(4, 4)); L.pass(st); assert.strictEqual(st.phase, 'play');
  L.pass(st); assert.strictEqual(st.phase, 'scoring');
  assert.strictEqual(L.play(st, P(0, 0)).ok, false);
});

test('scoring: territory plus captured stones plus komi for white', () => {
  const st = board(['XXXXOOOOO', 'XXXXOOOOO', 'XXXXOOOOO', 'XXXXOOOOO', 'XXXXOOOOO', 'XXXXOOOOO', 'XXXXOOOOO', 'XXXXOOOOO', 'XXXXOOOOO']);
  for (let i = 0; i < 81; i++) st.board[i] = 0;                       // 돌은 한 줄 벽만 남기고 집을 센다
  for (let r = 0; r < 9; r++) { st.board[P(r, 3)] = 1; st.board[P(r, 5)] = 2; }
  st.phase = 'scoring'; st.captures[L.BLACK] = 2; st.captures[L.WHITE] = 1;
  const s = L.score(st);
  assert.strictEqual(s.territoryB, 27); assert.strictEqual(s.territoryW, 27);                 // (0~2열) 9*3, (6~8열) 9*3
  assert.strictEqual(s.black, 27 + 2); assert.strictEqual(s.white, 27 + 1 + 6.5);
  assert.strictEqual(s.margin, 29 - 34.5);
  const f = L.finish(st); assert.strictEqual(f.winner, L.WHITE); assert.strictEqual(f.margin, 5.5);
});

test('scoring: an empty area touching both colours is neutral and counts for nobody', () => {
  const st = L.newGame();
  st.board[P(0, 0)] = 1; st.board[P(8, 8)] = 2; st.phase = 'scoring';
  const s = L.score(st); assert.strictEqual(s.territoryB, 0); assert.strictEqual(s.territoryW, 0);
});

test('dead stones: tapping a stone marks its whole group, dead stones count as prisoners for the other side', () => {
  const st = board(['.X.OOOOOO', '.X.O.....', '.X.O.....', '.X.......', '.X.......', '.X.......', '.X.......', '.X.......', '.X.......']);
  st.board[P(2, 4)] = 1;                                              // 백 구역 안의 흑 돌 한 점
  st.phase = 'scoring';
  const before = L.score(st);
  assert.ok(L.toggleDead(st, P(2, 4))); assert.ok(st.dead.has(P(2, 4)));
  const after = L.score(st); assert.strictEqual(after.deadB, 1); assert.ok(after.white > before.white);
  L.toggleDead(st, P(2, 4)); assert.ok(!st.dead.has(P(2, 4)));
  L.toggleDead(st, P(3, 1)); assert.strictEqual(st.dead.size, 9, 'the whole 9-stone wall');
  assert.strictEqual(L.toggleDead(st, P(0, 0)), false, 'empty point');
});

test('resign ends the game at once; undo goes back a move including captures and history', () => {
  const st = L.newGame();
  L.play(st, P(0, 0)); L.play(st, P(0, 1)); L.play(st, P(8, 8)); L.play(st, P(1, 0));
  assert.strictEqual(st.board[P(0, 0)], 0);
  assert.ok(L.undo(st)); assert.strictEqual(st.board[P(0, 0)], 1); assert.strictEqual(st.turn, L.WHITE); assert.strictEqual(st.captures[L.WHITE], 0);
  assert.ok(L.undo(st, 2)); assert.strictEqual(st.moves.length, 1);
  const r = L.newGame(); L.resign(r, L.BLACK); assert.strictEqual(r.phase, 'over'); assert.strictEqual(r.result.winner, L.WHITE); assert.ok(r.result.resign);
});

test('the computer: always plays a legal move, takes a stone in atari, passes when nothing is left', () => {
  const rand = L.rng(3);
  const st = L.newGame();
  const m = L.chooseMove(st, { playouts: 200, rand }); assert.ok(m >= 0 && L.legalMoves(st).includes(m));
  // 백 한 점이 단수 → 흑이 잡는 수
  const atari = board(['XO.......', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........']);
  atari.board[P(0, 1)] = 2; atari.board[P(0, 0)] = 1; atari.board[P(1, 1)] = 1; atari.turn = L.BLACK;      // 백 (0,1): 이웃 (0,0)흑 (1,1)흑 (0,2) 빈 곳 → 단수
  const cap = L.chooseMove(atari, { playouts: 250, rand: L.rng(9) });
  assert.strictEqual(cap, P(0, 2), 'captures the stone in atari');
  const full = board(['XXXXXXXXX', 'XXXXXXXXX', 'XXXXXXXXX', 'XXXXXXXXX', 'XXXXXXXXX', 'XXXXXXXXX', 'XXXXXXXXX', 'XXXXXXXXX', 'XXXXXX.XX']);
  full.turn = L.BLACK; assert.strictEqual(L.chooseMove(full, { playouts: 50, rand }), -1, 'it will not fill its own eye');
});

test('the computer finishes whole games without breaking the rules (no stone without liberties, positions never repeat)', () => {
  for (let seed = 1; seed <= 4; seed++) {
    const rand = L.rng(seed), st = L.newGame(); let k = 0;
    while (st.phase === 'play' && k++ < 260) {
      const m = L.chooseMove(st, { playouts: 25, rand });
      if (m < 0) L.pass(st); else assert.ok(L.play(st, m).ok, 'ai move accepted');
      for (let i = 0; i < 81; i++) if (st.board[i]) assert.ok(L.group(st.board, i, 9).libs.length > 0, 'a stone without liberties on the board');
    }
    assert.ok(st.phase === 'scoring' || k >= 260);
    if (st.phase === 'scoring') { st.dead = L.estimateDead(st, 20, rand); const r = L.finish(st); assert.ok(r.winner === 1 || r.winner === 2); }
  }
});
