// A quick report on a course: `npm run ride-check <id>` (or no id for every course). Rides it with the simulated rider standing and
// tucked, and lists anything worth a look: stalls, bails, slow stretches, hard landings, steep spots outside the features.
import { createCourse } from '../src/course.js';
import { COURSES } from '../src/courses/index.js';
import { rideCourse } from '../src/ride-sim.js';
import { railProblems } from '../src/rails.js';

const ids = process.argv.slice(2);
const defs = ids.length ? ids.map(id => { const d = COURSES.find(c => c.id === id); if (!d) throw new Error(`No course "${id}". Known: ${COURSES.map(c => c.id).join(', ')}`); return d; }) : COURSES;
const kmh = v => `${(v * 3.6).toFixed(0)} km/h`;
const time = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
let problems = 0;

for (const def of defs) {
  const c = createCourse(def);
  const top = c.pointAt(c.startS).y, bottom = c.pointAt(c.finishS).y, run = c.finishS - c.startS;
  console.log(`\n=== ${def.id} (${def.name}) ===`);
  console.log(`start gate ${c.startS.toFixed(0)} m, finish ${c.finishS.toFixed(0)} m: ${run.toFixed(0)} m long, ${(top - bottom).toFixed(0)} m drop, average ${(Math.atan((top - bottom) / run) * 57.3).toFixed(1)} degrees`);
  const stand = rideCourse(c), tuck = rideCourse(c, { tuck: 1 });
  for (const [label, r] of [['standing', stand], ['tucked  ', tuck]]) {
    console.log(`${label}: ${r.finished ? 'finished in ' + time(r.time) : 'DID NOT FINISH'}, top speed ${kmh(r.maxSpeed)}, ${r.airs.length} airs, ${r.bails.length} bails, ${r.stalls.length} stalls, strayed ${r.maxOff.toFixed(1)} m`);
    if (!r.finished || r.bails.length || r.stalls.length) problems += 1;
  }
  const flag = (msg) => { console.log('  ! ' + msg); problems += 1; };
  for (const b of stand.bails) flag(`bail at ${b.s.toFixed(0)} m (landed ${(b.tilt * 57.3).toFixed(0)} degrees off)`);
  for (const st of stand.stalls) flag(`stall at ${st.s.toFixed(0)} m: too flat to keep moving, steepen the profile there`);
  // Slow stretches: 150 m or more below 30 km/h standing.
  let slowFrom = null;
  for (const [s, v] of [...stand.speeds, [Infinity, 99]]) {
    if (v < 8.3 && slowFrom === null) slowFrom = s;
    if (v >= 8.3 && slowFrom !== null) { if (s - slowFrom >= 150 && s !== Infinity) console.log(`  - slow stretch ${slowFrom}-${s} m (under 30 km/h standing): fine if intended, else steepen`); slowFrom = null; }
  }
  for (const a of stand.airs) if (a.heavy) flag(`heavy landing at ${a.s.toFixed(0)} m even with the board pitched to meet the ground (${(a.tilt * 57.3).toFixed(0)} degrees off): the landing is steeper or more banked than a rider can match`);
  { // for interest: the same run with hands off the stick in the air (nothing levels the board, so the big jumps should cost something)
    const hands = rideCourse(c, { skill: false });
    console.log(`hands off in the air: ${hands.airs.filter(a => a.heavy).length} heavy landings, ${hands.bails.length} bails (of ${hands.airs.length} airs)${hands.bails.length ? ` at ${hands.bails.map(b => b.s.toFixed(0)).join(', ')} m` : ''}`);
  }
  for (const a of stand.airs) if (a.impact > 13) console.log(`  - hard landing at ${a.s.toFixed(0)} m (${a.air.toFixed(1)} s of air, ${a.impact.toFixed(0)} m/s into the ground): lengthen or steepen that landing`);
  c.kickers.forEach((k, i) => { if (!stand.airs.some(a => a.s > k && a.s < k + c.kickerReach[i])) flag(`no air off the kicker at ${k.toFixed(0)} m: too slow there, or the lip doesn't point up enough`); });
  // Rails: each one against the rules, then a rider lined up on it from 45 m back (it should be caught at the start and ride it out).
  for (const [i, rail] of c.rails.entries()) {
    const label = `rail ${i} (${rail.from.toFixed(0)}-${rail.to.toFixed(0)} m, ${rail.length.toFixed(0)} m of bar)`;
    for (const problem of railProblems(rail, c)) flag(`${label}: ${problem}`);
    const r = rideCourse(c, { from: rail.from - 45, until: rail.to + 30, speed: 12, offset: s => rail.offsetAt(s) });
    const mine = r.grinds.filter(g => g.rail === i), caught = mine.find(g => g.phase === 'start'), left = mine.find(g => g.phase === 'end');
    if (!caught) flag(`${label}: a rider lined up on it was never caught`);
    else if (!left || left.reason !== 'end') flag(`${label}: the rider left it by ${left?.reason ?? 'never leaving'}`);
    else console.log(`${label}: caught at ${caught.s.toFixed(0)} m, ground ${left.distance.toFixed(0)} m in ${left.time.toFixed(1)} s`);
  }
  for (let s = c.startS; s < c.finishS; s += 0.5) {
    if (c.features.some(f => s > f.from - 2 && s < f.to + 2)) continue;
    const p = c.pointAt(s), n = c.normalAt(p.x, p.z), slope = Math.acos(n.y) * 57.3;
    if (slope >= 30) { flag(`lane steeper than 30 degrees at ${s.toFixed(0)} m (${slope.toFixed(0)}), outside any feature`); s += 20; }
  }
  console.log(`airs (standing): ${stand.airs.map(a => `${a.s.toFixed(0)}m ${a.air.toFixed(1)}s`).join(', ') || 'none'}`);
}
console.log(problems ? `\n${problems} problem(s) to fix.` : '\nNo problems. Run `npm test` before calling it done.');
process.exitCode = problems ? 1 : 0;
