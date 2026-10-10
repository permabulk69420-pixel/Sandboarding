import { stickAxis, clamp } from './math.js';

// One place that turns controllers (or the keyboard) into game intent. Buttons are xr-standard indices on Quest Touch:
// 0 trigger, 1 grip, 3 thumbstick click, 4 A/X, 5 B/Y. `pressed` flags are true only on the frame a button goes down.

const BTN = { trigger: 0, grip: 1, stick: 3, primary: 4, secondary: 5 };

export function createInput() {
  const keys = new Set();
  const was = new Map();
  addEventListener('keydown', e => { keys.add(e.code); if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault(); });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  const edge = (id, down) => { const before = was.get(id) || false; was.set(id, down); return down && !before; };

  function read(session) {
    const out = {
      moveX: 0, moveZ: 0, turn: 0, steer: 0, brake: 0, tuckKey: 0,
      a: false, b: false, x: false, y: false, // right A, right B, left X, left Y (edges)
      any: false,
    };
    if (session) {
      for (const source of session.inputSources) {
        const pad = source.gamepad; if (!pad) continue;
        const axes = pad.axes || [], b = pad.buttons || [];
        const ax = axes.length >= 4 ? 2 : 0;
        const sx = stickAxis(axes[ax] || 0), sy = stickAxis(axes[ax + 1] || 0);
        const trig = b[BTN.trigger]?.value ?? 0;
        out.brake = Math.max(out.brake, trig > 0.1 ? trig : 0);
        if (Math.abs(sx) > Math.abs(out.steer)) out.steer = sx;
        if (source.handedness === 'left') {
          out.moveX = sx; out.moveZ = sy;
          out.x = edge('x', Boolean(b[BTN.primary]?.pressed)); out.y = edge('y', Boolean(b[BTN.secondary]?.pressed));
        } else if (source.handedness === 'right') {
          out.turn = sx;
          out.a = edge('a', Boolean(b[BTN.primary]?.pressed)); out.b = edge('b', Boolean(b[BTN.secondary]?.pressed));
        }
      }
    } else {
      const k = c => keys.has(c);
      out.moveX = Number(k('KeyD')) - Number(k('KeyA'));
      out.moveZ = Number(k('KeyS')) - Number(k('KeyW'));
      out.turn = Number(k('ArrowRight') || k('KeyE')) - Number(k('ArrowLeft') || k('KeyQ'));
      out.steer = clamp(Number(k('KeyD') || k('ArrowRight')) - Number(k('KeyA') || k('ArrowLeft')), -1, 1);
      out.brake = Number(k('KeyS') || k('ArrowDown'));
      out.tuckKey = Number(k('KeyW') || k('ArrowUp') || k('ShiftLeft'));
      out.a = edge('a', k('Space') || k('Enter'));
      out.b = edge('b', k('KeyR'));
      out.y = edge('y', k('KeyT'));
    }
    out.any = out.a || out.b || out.x || out.y;
    return out;
  }

  return { read };
}
